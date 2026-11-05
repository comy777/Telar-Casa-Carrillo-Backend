import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Page } from '../../../shared/application/audit-trail';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import { uniqueViolationFields } from '../../../shared/infrastructure/prisma/prisma-errors';
import type {
  PaymentListQuery,
  PaymentRecord,
  PaymentRepository,
  RefundRecord,
  RefundRepository,
  StoredWebhook,
  WebhookEventRepository,
} from '../application/ports';
import type { GatewayStatus, PaymentStatus, RefundStatus, ReviewReason } from '../domain/payment';

const cents = (value: Prisma.Decimal): number => Math.round(value.mul(100).toNumber());
const decimal = (value: number): Prisma.Decimal => new Prisma.Decimal(value).div(100);
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

const paymentInclude = { order: { select: { orderNumber: true } } } satisfies Prisma.PaymentInclude;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

const toPayment = (row: PaymentRow): PaymentRecord => ({
  id: row.id,
  orderId: row.orderId,
  orderNumber: row.order.orderNumber,
  provider: row.provider,
  providerReference: row.providerReference,
  reference: row.idempotencyKey,
  status: row.status,
  amountCents: cents(row.amount),
  currency: row.currency,
  paymentMethodType: row.paymentMethodType,
  reviewReason: row.reviewReason as ReviewReason | null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async create(payment: {
    id: string;
    orderId: string;
    provider: string;
    reference: string;
    amountCents: number;
    currency: string;
  }): Promise<void> {
    await this.db.client.payment.create({
      data: {
        id: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        idempotencyKey: payment.reference,
        amount: decimal(payment.amountCents),
        currency: payment.currency,
      },
    });
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    const row = await this.db.client.payment.findUnique({ where: { id }, include: paymentInclude });
    return row ? toPayment(row) : null;
  }

  async findByReference(reference: string): Promise<PaymentRecord | null> {
    const row = await this.db.client.payment.findUnique({
      where: { idempotencyKey: reference },
      include: paymentInclude,
    });
    return row ? toPayment(row) : null;
  }

  async listForOrder(orderId: string): Promise<PaymentRecord[]> {
    const rows = await this.db.client.payment.findMany({
      where: { orderId },
      include: paymentInclude,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toPayment);
  }

  async list(query: PaymentListQuery): Promise<Page<PaymentRecord>> {
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.needsReview ? { reviewReason: { not: null } } : {}),
      ...(query.orderNumber ? { order: { orderNumber: query.orderNumber.toUpperCase() } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.client.payment.count({ where }),
    ]);
    return { items: rows.map(toPayment), total, page: query.page, pageSize: query.pageSize };
  }

  async transition(id: string, from: PaymentStatus, to: PaymentStatus): Promise<boolean> {
    const result = await this.db.client.payment.updateMany({
      where: { id, status: from },
      data: { status: to },
    });
    return result.count === 1;
  }

  async attachTransaction(id: string, providerReference: string, paymentMethodType: string | null) {
    await this.db.client.payment.updateMany({
      where: { id, providerReference: null },
      data: { providerReference, paymentMethodType },
    });
  }

  async flagForReview(id: string, reason: ReviewReason): Promise<void> {
    await this.db.client.payment.update({ where: { id }, data: { reviewReason: reason } });
  }

  async pendingWithTransaction(updatedBefore: Date, limit: number): Promise<PaymentRecord[]> {
    const rows = await this.db.client.payment.findMany({
      where: {
        status: 'PENDING',
        providerReference: { not: null },
        updatedAt: { lte: updatedBefore },
      },
      include: paymentInclude,
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toPayment);
  }

  async hasPendingTransaction(orderId: string, since: Date): Promise<boolean> {
    const count = await this.db.client.payment.count({
      where: {
        orderId,
        status: 'PENDING',
        providerReference: { not: null },
        createdAt: { gte: since },
      },
    });
    return count > 0;
  }

  async recordTransaction(entry: {
    paymentId: string;
    provider: string;
    providerEventId: string;
    eventType: string;
    status: GatewayStatus;
    payload: unknown;
  }): Promise<void> {
    // Repetidos (mismo evento) se ignoran: la unicidad por proveedor da la idempotencia.
    await this.db.client.paymentTransaction.createMany({
      data: [
        {
          paymentId: entry.paymentId,
          provider: entry.provider,
          providerEventId: entry.providerEventId,
          eventType: entry.eventType,
          status: entry.status,
          payload: json(entry.payload),
          processedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
  }
}

type RefundRow = Prisma.RefundGetPayload<object>;

const toRefund = (row: RefundRow): RefundRecord => ({
  id: row.id,
  paymentId: row.paymentId,
  providerReference: row.providerReference,
  status: row.status,
  amountCents: cents(row.amount),
  reason: row.reason,
  failureReason: row.failureReason,
  idempotencyKey: row.idempotencyKey,
  requestedById: row.requestedById,
  createdAt: row.createdAt,
});

@Injectable()
export class PrismaRefundRepository implements RefundRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async findByIdempotencyKey(key: string): Promise<RefundRecord | null> {
    const row = await this.db.client.refund.findUnique({ where: { idempotencyKey: key } });
    return row ? toRefund(row) : null;
  }

  async findById(id: string): Promise<RefundRecord | null> {
    const row = await this.db.client.refund.findUnique({ where: { id } });
    return row ? toRefund(row) : null;
  }

  async listForPayment(paymentId: string): Promise<RefundRecord[]> {
    const rows = await this.db.client.refund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRefund);
  }

  committedCents(paymentId: string): Promise<number> {
    return this.sum(paymentId, ['PENDING', 'APPROVED']);
  }

  approvedCents(paymentId: string): Promise<number> {
    return this.sum(paymentId, ['APPROVED']);
  }

  async create(
    refund: Omit<RefundRecord, 'createdAt' | 'status' | 'providerReference' | 'failureReason'>,
  ): Promise<void> {
    try {
      await this.db.client.refund.create({
        data: {
          id: refund.id,
          paymentId: refund.paymentId,
          amount: decimal(refund.amountCents),
          reason: refund.reason,
          idempotencyKey: refund.idempotencyKey,
          requestedById: refund.requestedById,
        },
      });
    } catch (error) {
      if (uniqueViolationFields(error)?.includes('idempotencyKey')) {
        throw new Error('Reembolso duplicado en paralelo; reintenta con la misma clave');
      }
      throw error;
    }
  }

  async resolve(
    id: string,
    result: {
      status: RefundStatus;
      providerReference: string | null;
      failureReason: string | null;
    },
  ): Promise<boolean> {
    const updated = await this.db.client.refund.updateMany({
      where: { id, status: 'PENDING' },
      data: result,
    });
    return updated.count === 1;
  }

  private async sum(paymentId: string, statuses: RefundStatus[]): Promise<number> {
    const aggregate = await this.db.client.refund.aggregate({
      where: { paymentId, status: { in: statuses } },
      _sum: { amount: true },
    });
    return aggregate._sum.amount ? cents(aggregate._sum.amount) : 0;
  }
}

@Injectable()
export class PrismaWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async store(event: {
    provider: string;
    providerEventId: string;
    eventType: string;
    signatureValid: boolean;
    payload: unknown;
  }): Promise<StoredWebhook> {
    const where = {
      provider_providerEventId: {
        provider: event.provider,
        providerEventId: event.providerEventId,
      },
    };
    const existing = await this.db.client.webhookEvent.findUnique({ where });
    if (existing) return { id: existing.id, processed: existing.processedAt !== null };
    try {
      const created = await this.db.client.webhookEvent.create({
        data: {
          provider: event.provider,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          signatureValid: event.signatureValid,
          payload: json(event.payload),
        },
      });
      return { id: created.id, processed: false };
    } catch (error) {
      // Dos entregas simultáneas del mismo evento: gana la primera.
      if (uniqueViolationFields(error)) {
        const row = await this.db.client.webhookEvent.findUniqueOrThrow({ where });
        return { id: row.id, processed: row.processedAt !== null };
      }
      throw error;
    }
  }

  async markProcessed(id: string, paymentId: string | null): Promise<void> {
    await this.db.client.webhookEvent.update({
      where: { id },
      data: { processedAt: new Date(), processingError: null, paymentId },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db.client.webhookEvent.update({
      where: { id },
      data: { processingError: error.slice(0, 1000) },
    });
  }
}
