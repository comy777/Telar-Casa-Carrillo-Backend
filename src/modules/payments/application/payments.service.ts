import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUDIT_TRAIL, type AuditTrail } from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { DOMAIN_EVENTS, type DomainEvents } from '../../../shared/application/domain-events';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import {
  AuthenticationError,
  BusinessRuleViolation,
  DomainError,
  NotFoundError,
} from '../../../shared/domain/errors';
import { CustomerOrders, OrderLifecycle } from '../../ordering/application/orders.services';
import type { OrderRecord } from '../../ordering/application/ports';
import { canMovePayment, type PaymentStatus, type ReviewReason } from '../domain/payment';
import {
  type CheckoutSession,
  type GatewayTransaction,
  PAYMENT_GATEWAY,
  PAYMENT_REPOSITORY,
  PAYMENT_SETTINGS,
  type PaymentGateway,
  type PaymentRecord,
  type PaymentRepository,
  type PaymentSettings,
  WEBHOOK_EVENT_REPOSITORY,
  type WebhookEventRepository,
} from './ports';

/** Cómo prueba el cliente que el pedido es suyo: sesión o token del correo. */
export interface OrderAccess {
  orderNumber: string;
  userId: string | null;
  token: string | null;
}

export type StartedPayment =
  | { kind: 'checkout'; reference: string; session: CheckoutSession }
  /** Pedido con total 0 (p. ej. cupón del 100 %): queda pagado sin pasarela. */
  | { kind: 'free'; order: OrderRecord };

export interface AppliedTransaction {
  payment: PaymentRecord | null;
  order: OrderRecord | null;
}

/** Tras este tiempo sin noticias, la conciliación consulta la pasarela. */
const RECONCILE_AFTER_MS = 2 * 60_000;
/** Un pago iniciado hace más de esto no retiene el vencimiento del pedido. */
const AWAIT_PAYMENT_MS = 24 * 3_600_000;

/**
 * Pagos. Regla central: un pedido solo queda pagado cuando la pasarela lo
 * confirma (evento firmado o consulta con la llave privada), nunca por lo que
 * diga el navegador.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(WEBHOOK_EVENT_REPOSITORY) private readonly webhooks: WebhookEventRepository,
    @Inject(PAYMENT_SETTINGS) private readonly settings: PaymentSettings,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DOMAIN_EVENTS) private readonly events: DomainEvents,
    private readonly orders: CustomerOrders,
    private readonly lifecycle: OrderLifecycle,
  ) {}

  /** Crea un intento de pago y devuelve lo necesario para abrir la pasarela. */
  async start(access: OrderAccess): Promise<StartedPayment> {
    const order = await this.orderFor(access);
    if (order.status !== 'PENDING_PAYMENT') {
      throw new BusinessRuleViolation(
        order.paidAt ? 'El pedido ya está pagado' : 'El pedido ya no admite pagos',
        order.paidAt ? 'ORDER_ALREADY_PAID' : 'ORDER_NOT_PAYABLE',
        { status: order.status },
      );
    }
    if (order.paymentDueAt && order.paymentDueAt <= this.clock.now()) {
      throw new BusinessRuleViolation(
        'Venció el plazo para pagar el pedido',
        'ORDER_PAYMENT_EXPIRED',
      );
    }

    if (order.grandTotalCents === 0) {
      await this.unitOfWork.execute(() => this.lifecycle.markPaid(order.id, 'Total en cero'));
      await this.lifecycle.issueInvoice(order.id);
      return { kind: 'free', order: await this.lifecycle.require(order.id) };
    }

    // Una referencia por intento: la pasarela no admite reutilizarlas.
    const reference = `${order.orderNumber}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const legal = order.customer.documentType && order.customer.documentType !== 'PPT';
    const session = this.gateway.createCheckout({
      reference,
      amountCents: order.grandTotalCents,
      currency: 'COP',
      expiresAt: order.paymentDueAt,
      // Sin query string: la pasarela agrega ?id=<transacción>.
      redirectUrl: `${this.settings.storefrontUrl}/pedido/${order.orderNumber}/pago`,
      customer: {
        email: order.customer.email,
        fullName: order.customer.name,
        phone: order.customer.phone,
        legalIdType: legal ? order.customer.documentType : null,
        legalId: legal ? order.customer.documentNumber : null,
      },
    });
    // Se guarda después de armar la sesión: si la pasarela no está configurada no queda un pago huérfano.
    await this.payments.create({
      id: crypto.randomUUID(),
      orderId: order.id,
      provider: this.gateway.provider,
      reference,
      amountCents: order.grandTotalCents,
      currency: order.currency,
    });
    return { kind: 'checkout', reference, session };
  }

  /**
   * El cliente vuelve de la pasarela con el id de la transacción: se consulta
   * a la pasarela (no se confía en el navegador) y se aplica el resultado.
   */
  async confirmFromRedirect(access: OrderAccess, transactionId: string): Promise<OrderRecord> {
    const order = await this.orderFor(access);
    const transaction = await this.gateway.fetchTransaction(transactionId);
    const payment = transaction ? await this.payments.findByReference(transaction.reference) : null;
    if (!transaction || payment?.orderId !== order.id) {
      throw new NotFoundError('Transacción');
    }
    await this.apply(transaction, 'redirect');
    return this.lifecycle.require(order.id);
  }

  /**
   * Notificación de la pasarela. Se guarda siempre antes de procesarla; las
   * repetidas no se procesan dos veces. Si el procesamiento falla se lanza el
   * error para que la pasarela reintente.
   */
  async handleWebhook(body: unknown, headers: Record<string, string | undefined>): Promise<void> {
    const event = this.gateway.parseEvent(body, headers);
    const stored = await this.webhooks.store({
      provider: this.gateway.provider,
      providerEventId: event.eventId,
      eventType: event.eventType,
      signatureValid: event.signatureValid,
      payload: body,
    });
    if (!event.signatureValid) {
      this.logger.warn(`Notificación con firma inválida (${event.eventType})`);
      throw new AuthenticationError('Firma de la notificación inválida', 'INVALID_SIGNATURE');
    }
    if (stored.processed) return;
    if (!event.transaction) {
      await this.webhooks.markProcessed(stored.id, null);
      return;
    }
    try {
      const { payment } = await this.apply(event.transaction, event.eventType, event.eventId);
      if (!payment)
        this.logger.warn(
          `Notificación de una referencia desconocida: ${event.transaction.reference}`,
        );
      await this.webhooks.markProcessed(stored.id, payment?.id ?? null);
    } catch (error) {
      await this.webhooks.markFailed(
        stored.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /** Proceso programado: consulta los pagos que siguen pendientes en la pasarela. */
  async reconcile(limit = 50): Promise<number> {
    const now = this.clock.now();
    const pending = await this.payments.pendingWithTransaction(
      new Date(now.getTime() - RECONCILE_AFTER_MS),
      limit,
    );
    let updated = 0;
    for (const payment of pending) {
      try {
        const transaction = await this.gateway.fetchTransaction(payment.providerReference!);
        if (transaction && transaction.status !== 'PENDING') {
          await this.apply(transaction, 'reconciliation');
          updated += 1;
        }
      } catch (error) {
        this.logger.warn(`No se pudo conciliar el pago ${payment.reference}: ${String(error)}`);
      }
    }
    return updated;
  }

  /** Un pedido con un pago en curso (p. ej. PSE) no se cancela al vencer: se espera. */
  isAwaitingPayment(orderId: string): Promise<boolean> {
    return this.payments.hasPendingTransaction(
      orderId,
      new Date(this.clock.now().getTime() - AWAIT_PAYMENT_MS),
    );
  }

  /** Aplica lo que reporta la pasarela. Idempotente y tolerante al desorden. */
  async apply(
    transaction: GatewayTransaction,
    source: string,
    eventId?: string,
  ): Promise<AppliedTransaction> {
    const result = await this.unitOfWork.execute(async () => {
      const payment = await this.payments.findByReference(transaction.reference);
      if (!payment) return { payment: null, paidOrderId: null };

      await this.payments.recordTransaction({
        paymentId: payment.id,
        provider: this.gateway.provider,
        providerEventId: eventId ?? `${source}:${transaction.id}:${transaction.status}`,
        eventType: source,
        status: transaction.status,
        payload: transaction,
      });

      if (payment.providerReference && payment.providerReference !== transaction.id) {
        // Otra transacción con la misma referencia: si se cobró, hay que devolverla.
        if (transaction.status === 'APPROVED') await this.flag(payment, 'DUPLICATE_PAYMENT');
        return { payment, paidOrderId: null };
      }
      if (!payment.providerReference) {
        await this.payments.attachTransaction(
          payment.id,
          transaction.id,
          transaction.paymentMethodType,
        );
      }

      const target: PaymentStatus = transaction.status;
      if (!canMovePayment(payment.status, target)) return { payment, paidOrderId: null };
      if (!(await this.payments.transition(payment.id, payment.status, target))) {
        return { payment, paidOrderId: null };
      }
      if (target !== 'APPROVED') return { payment, paidOrderId: null };

      if (
        transaction.amountCents !== payment.amountCents ||
        transaction.currency !== payment.currency
      ) {
        await this.flag(payment, 'AMOUNT_MISMATCH');
        return { payment, paidOrderId: null };
      }
      try {
        const paid = await this.lifecycle.markPaid(
          payment.orderId,
          `Pago ${payment.reference} aprobado (${transaction.paymentMethodType ?? this.gateway.provider})`,
        );
        if (paid.alreadyPaid) {
          await this.flag(payment, 'DUPLICATE_PAYMENT');
          return { payment, paidOrderId: null };
        }
        if (paid.shortages.length > 0) await this.flag(payment, 'STOCK_SHORTAGE');
        return { payment, paidOrderId: payment.orderId };
      } catch (error) {
        // Pago aprobado para un pedido cancelado (llegó tarde): se revisa y se reembolsa.
        if (error instanceof DomainError && error.code === 'ORDER_NOT_PAYABLE') {
          await this.flag(payment, 'ORDER_NOT_PAYABLE');
          return { payment, paidOrderId: null };
        }
        throw error;
      }
    });

    if (result.paidOrderId) await this.lifecycle.issueInvoice(result.paidOrderId);
    const payment = result.payment ? await this.payments.findById(result.payment.id) : null;
    const order = payment ? await this.lifecycle.require(payment.orderId) : null;
    return { payment, order };
  }

  private async orderFor(access: OrderAccess): Promise<OrderRecord> {
    const number = access.orderNumber.toUpperCase();
    if (access.userId) return this.orders.getForUser(access.userId, number);
    if (access.token) return this.orders.getForGuest(number, access.token);
    throw new NotFoundError('Pedido');
  }

  private async flag(payment: PaymentRecord, reason: ReviewReason): Promise<void> {
    await this.payments.flagForReview(payment.id, reason);
    await this.audit.record({
      actorId: null,
      action: 'payment.needs_review',
      resource: 'Payment',
      resourceId: payment.id,
      metadata: { reason, reference: payment.reference, orderNumber: payment.orderNumber },
    });
    this.events.publish({
      type: 'payment.needs_review',
      paymentId: payment.id,
      reason,
      orderNumber: payment.orderNumber,
    });
    this.logger.warn(`Pago ${payment.reference} requiere revisión: ${reason}`);
  }
}
