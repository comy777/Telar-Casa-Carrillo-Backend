import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Page, PageRequest } from '../../../shared/application/audit-trail';
import { ConflictError } from '../../../shared/domain/errors';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import { uniqueViolationFields } from '../../../shared/infrastructure/prisma/prisma-errors';
import type { PostalAddress } from '../../shipping/domain/address';
import type {
  ElectronicInvoiceIssuer,
  IssuedInvoice,
  NewOrder,
  OrderAccessTokens,
  OrderListQuery,
  OrderRecord,
  OrderRepository,
  TransitionChange,
} from '../application/ports';

const cents = (value: Prisma.Decimal): number => Math.round(value.mul(100).toNumber());
const decimal = (value: number): Prisma.Decimal => new Prisma.Decimal(value).div(100);
const basisPoints = (value: Prisma.Decimal): number => Math.round(value.mul(10_000).toNumber());

const orderInclude = {
  items: { orderBy: { productName: 'asc' } },
  statusHistory: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  coupon: { select: { code: true } },
  shippingMethod: { select: { id: true, name: true } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const asObject = (value: Prisma.JsonValue): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function toRecord(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    userId: row.userId,
    status: row.status,
    currency: row.currency,
    subtotalCents: cents(row.subtotal),
    discountTotalCents: cents(row.discountTotal),
    shippingTotalCents: cents(row.shippingTotal),
    taxTotalCents: cents(row.taxTotal),
    grandTotalCents: cents(row.grandTotal),
    customer: {
      email: row.customerEmail,
      name: row.customerName,
      phone: row.customerPhone,
      documentType: row.customerDocumentType,
      documentNumber: row.customerDocumentNumber,
    },
    shippingAddress: asObject(row.shippingAddressSnapshot) as unknown as PostalAddress,
    billingAddress: row.billingAddressSnapshot
      ? (asObject(row.billingAddressSnapshot) as unknown as PostalAddress)
      : null,
    shippingMethod: row.shippingMethod,
    couponCode: row.coupon?.code ?? null,
    notes: row.notes,
    guestAccessTokenHash: row.guestAccessTokenHash,
    paymentDueAt: row.paymentDueAt,
    paidAt: row.paidAt,
    cancelledAt: row.cancelledAt,
    invoice: row.invoiceNumber
      ? { number: row.invoiceNumber, cufe: row.invoiceCufe, issuedAt: row.invoicedAt }
      : null,
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      unitPriceCents: cents(item.unitPrice),
      quantity: item.quantity,
      discountCents: cents(item.discountTotal),
      lineTotalCents: cents(item.lineTotal),
      taxRateBasisPoints: basisPoints(item.taxRate),
      taxCents: cents(item.taxTotal),
      snapshot: asObject(item.productSnapshot),
    })),
    history: row.statusHistory.map((entry) => ({
      from: entry.from,
      to: entry.to,
      actorId: entry.actorId,
      note: entry.note,
      createdAt: entry.createdAt,
    })),
    createdAt: row.createdAt,
  };
}

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async nextSequence(): Promise<number> {
    const [row] = await this.db.client.$queryRaw<{ value: bigint }[]>`
      SELECT nextval('order_number_seq') AS "value"`;
    return Number(row!.value);
  }

  async create(order: NewOrder): Promise<void> {
    await this.db.client.order.create({
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        couponId: order.couponId,
        shippingMethodId: order.shippingMethodId,
        status: 'PENDING_PAYMENT',
        currency: order.currency,
        subtotal: decimal(order.subtotalCents),
        discountTotal: decimal(order.discountTotalCents),
        shippingTotal: decimal(order.shippingTotalCents),
        taxTotal: decimal(order.taxTotalCents),
        grandTotal: decimal(order.grandTotalCents),
        customerEmail: order.customer.email,
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        customerDocumentType: order.customer.documentType,
        customerDocumentNumber: order.customer.documentNumber,
        shippingAddressSnapshot: json(order.shippingAddress),
        billingAddressSnapshot: order.billingAddress ? json(order.billingAddress) : Prisma.DbNull,
        notes: order.notes,
        guestAccessTokenHash: order.guestAccessTokenHash,
        paymentDueAt: order.paymentDueAt,
        termsAcceptedAt: order.termsAcceptedAt,
        privacyPolicyVersion: order.privacyPolicyVersion,
        createdAt: order.createdAt,
        items: {
          create: order.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            variantId: item.variantId,
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            unitPrice: decimal(item.unitPriceCents),
            quantity: item.quantity,
            discountTotal: decimal(item.discountCents),
            lineTotal: decimal(item.lineTotalCents),
            taxRate: new Prisma.Decimal(item.taxRateBasisPoints).div(10_000),
            taxTotal: decimal(item.taxCents),
            productSnapshot: json(item.snapshot),
          })),
        },
        statusHistory: {
          create: { from: null, to: 'PENDING_PAYMENT', createdAt: order.createdAt },
        },
      },
    });
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const row = await this.db.client.order.findUnique({ where: { id }, include: orderInclude });
    return row ? toRecord(row) : null;
  }

  async findByNumber(orderNumber: string): Promise<OrderRecord | null> {
    const row = await this.db.client.order.findUnique({
      where: { orderNumber },
      include: orderInclude,
    });
    return row ? toRecord(row) : null;
  }

  listForUser(userId: string, page: PageRequest): Promise<Page<OrderRecord>> {
    return this.page({ userId }, page);
  }

  list(query: OrderListQuery): Promise<Page<OrderRecord>> {
    const search = query.search?.trim();
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
      ...(query.invoicePending
        ? { invoiceNumber: null, status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } }
        : {}),
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search, mode: 'insensitive' } },
              { customerEmail: { contains: search, mode: 'insensitive' } },
              { customerName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.page(where, query);
  }

  async transition(id: string, change: TransitionChange): Promise<boolean> {
    const result = await this.db.client.order.updateMany({
      where: { id, status: change.from },
      data: {
        status: change.to,
        ...(change.to === 'PAID' ? { paidAt: change.at } : {}),
        ...(change.to === 'CANCELLED' ? { cancelledAt: change.at } : {}),
      },
    });
    if (result.count !== 1) return false;
    await this.db.client.orderStatusHistory.create({
      data: {
        orderId: id,
        from: change.from,
        to: change.to,
        actorId: change.actorId,
        note: change.note ?? null,
        createdAt: change.at,
      },
    });
    return true;
  }

  async findOverdueUnpaid(now: Date, limit: number): Promise<string[]> {
    const rows = await this.db.client.order.findMany({
      where: { status: 'PENDING_PAYMENT', paymentDueAt: { lte: now } },
      select: { id: true },
      orderBy: { paymentDueAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  async setInvoice(id: string, invoice: { number: string; cufe: string | null; issuedAt: Date }) {
    try {
      await this.db.client.order.update({
        where: { id },
        data: {
          invoiceNumber: invoice.number,
          invoiceCufe: invoice.cufe,
          invoicedAt: invoice.issuedAt,
        },
      });
    } catch (error) {
      const fields = uniqueViolationFields(error);
      if (fields?.includes('invoiceNumber') || fields?.includes('invoiceCufe')) {
        throw new ConflictError('Esa factura ya está registrada en otro pedido', 'INVOICE_TAKEN');
      }
      throw error;
    }
  }

  private async page(where: Prisma.OrderWhereInput, page: PageRequest): Promise<Page<OrderRecord>> {
    const [rows, total] = await Promise.all([
      this.db.client.order.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.db.client.order.count({ where }),
    ]);
    return { items: rows.map(toRecord), total, page: page.page, pageSize: page.pageSize };
  }
}

export class CryptoOrderAccessTokens implements OrderAccessTokens {
  generate(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  matches(token: string, hash: string): boolean {
    const a = Buffer.from(this.hash(token), 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

/**
 * Sin proveedor tecnológico de facturación: la factura queda pendiente y se
 * registra a mano (PUT /admin/orders/:id/invoice) tras emitirla, por ejemplo,
 * en el facturador gratuito de la DIAN. Al contratar un proveedor se agrega
 * otro adaptador de ElectronicInvoiceIssuer y se selecciona con EINVOICE_PROVIDER.
 */
export class ManualInvoiceIssuer implements ElectronicInvoiceIssuer {
  issue(): Promise<IssuedInvoice | null> {
    return Promise.resolve(null);
  }
}
