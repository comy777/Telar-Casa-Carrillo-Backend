import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../../../shared/application/actor';
import { AUDIT_TRAIL, type AuditTrail, type Page } from '../../../shared/application/audit-trail';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, ConflictError, NotFoundError } from '../../../shared/domain/errors';
import { OrderLifecycle } from '../../ordering/application/orders.services';
import { isPaidStatus } from '../../ordering/domain/order-status';
import { assertRefundable, type RefundStatus, statusAfterRefunds } from '../domain/payment';
import {
  type GatewayRefund,
  PAYMENT_GATEWAY,
  PAYMENT_REPOSITORY,
  type PaymentGateway,
  type PaymentListQuery,
  type PaymentRecord,
  type PaymentRepository,
  REFUND_REPOSITORY,
  type RefundRecord,
  type RefundRepository,
} from './ports';

export interface RefundRequest {
  /** null = todo lo que queda por devolver. */
  amountCents: number | null;
  reason: string;
  /** Devolver las unidades al inventario si se completa el reembolso. */
  restock: boolean;
  idempotencyKey: string;
}

export interface PaymentDetail {
  payment: PaymentRecord;
  refunds: RefundRecord[];
}

/**
 * Reembolsos totales y parciales. Nunca se modifica el pago original: cada
 * reembolso es una fila propia y el estado del pago se deriva de la suma.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(REFUND_REPOSITORY) private readonly refunds: RefundRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    private readonly lifecycle: OrderLifecycle,
  ) {}

  list(query: PaymentListQuery): Promise<Page<PaymentRecord>> {
    return this.payments.list(query);
  }

  async detail(paymentId: string): Promise<PaymentDetail> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundError('Pago', paymentId);
    return { payment, refunds: await this.refunds.listForPayment(paymentId) };
  }

  /** Pide el reembolso a la pasarela. Repetir con la misma clave no duplica. */
  async request(actor: Actor, paymentId: string, request: RefundRequest): Promise<PaymentDetail> {
    const reason = request.reason.trim();
    if (!reason || reason.length > 300) {
      throw new BusinessRuleViolation('Indica el motivo del reembolso', 'REASON_REQUIRED');
    }
    const existing = await this.refunds.findByIdempotencyKey(request.idempotencyKey);
    if (existing) {
      if (existing.paymentId !== paymentId) {
        throw new ConflictError(
          'La clave de idempotencia ya se usó en otro pago',
          'IDEMPOTENCY_KEY_REUSED',
        );
      }
      return this.detail(paymentId);
    }

    const { payment, refund } = await this.unitOfWork.execute(async () => {
      const current = await this.payments.findById(paymentId);
      if (!current?.providerReference) throw new NotFoundError('Pago', paymentId);
      const committed = await this.refunds.committedCents(paymentId);
      const amountCents = request.amountCents ?? current.amountCents - committed;
      assertRefundable(current, committed, amountCents);
      const created = {
        id: crypto.randomUUID(),
        paymentId,
        amountCents,
        reason,
        idempotencyKey: request.idempotencyKey,
        requestedById: actor.id,
      };
      await this.refunds.create(created);
      await this.audit.record({
        actorId: actor.id,
        action: 'payment.refund_requested',
        resource: 'Payment',
        resourceId: paymentId,
        metadata: {
          refundId: created.id,
          amount: amountCents / 100,
          reason,
          restock: request.restock,
        },
        ipAddress: actor.context.ipAddress,
      });
      return { payment: current, refund: created };
    });

    // La llamada a la pasarela va fuera de la transacción.
    let result: GatewayRefund;
    try {
      result = await this.gateway.refund({
        transactionId: payment.providerReference!,
        amountCents: refund.amountCents,
        reason,
        reference: refund.id,
      });
    } catch (error) {
      this.logger.error(`La pasarela no procesó el reembolso ${refund.id}`, error);
      result = {
        providerReference: null,
        status: 'FAILED',
        failureReason: String(error).slice(0, 500),
      };
    }
    await this.settle(actor, refund.id, result, request.restock);
    return this.detail(paymentId);
  }

  /**
   * Reembolsos que la pasarela dejó en curso o que se hicieron fuera de ella
   * (p. ej. transferencia): el administrador confirma el resultado.
   */
  async resolve(
    actor: Actor,
    refundId: string,
    status: Exclude<RefundStatus, 'PENDING'>,
    restock: boolean,
    note: string | null,
  ): Promise<PaymentDetail> {
    const refund = await this.refunds.findById(refundId);
    if (!refund) throw new NotFoundError('Reembolso', refundId);
    if (refund.status !== 'PENDING') {
      throw new BusinessRuleViolation('El reembolso ya tiene resultado', 'REFUND_ALREADY_RESOLVED');
    }
    await this.settle(
      actor,
      refundId,
      {
        providerReference: refund.providerReference,
        status,
        failureReason: status === 'FAILED' ? note : null,
      },
      restock,
    );
    return this.detail(refund.paymentId);
  }

  private settle(
    actor: Actor,
    refundId: string,
    result: GatewayRefund,
    restock: boolean,
  ): Promise<void> {
    return this.unitOfWork.execute(async () => {
      const refund = (await this.refunds.findById(refundId))!;
      if (!(await this.refunds.resolve(refundId, result))) return;
      await this.audit.record({
        actorId: actor.id,
        action: `payment.refund_${result.status.toLowerCase()}`,
        resource: 'Payment',
        resourceId: refund.paymentId,
        metadata: { refundId, failureReason: result.failureReason },
        ipAddress: actor.context.ipAddress,
      });
      if (result.status !== 'APPROVED') return;

      const payment = (await this.payments.findById(refund.paymentId))!;
      const next = statusAfterRefunds(
        payment.amountCents,
        await this.refunds.approvedCents(payment.id),
      );
      if (next !== payment.status) await this.payments.transition(payment.id, payment.status, next);

      // Reembolso total de un pedido cobrado: se cancela o queda devuelto.
      const order = await this.lifecycle.require(payment.orderId);
      if (next === 'REFUNDED' && isPaidStatus(order.status)) {
        await this.lifecycle.closeWithRefund(
          order.id,
          actor.id,
          refund.reason ?? 'Reembolso total',
          restock,
        );
      }
    });
  }
}
