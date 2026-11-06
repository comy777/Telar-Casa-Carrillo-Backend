import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type {
  DateRange,
  ExportRow,
  ReportsReader,
  SystemSignals,
} from '../application/reports.service';

const cents = (value: Prisma.Decimal | null | undefined): number =>
  value ? Math.round(value.mul(100).toNumber()) : 0;
const pesos = (value: Prisma.Decimal | null): number | null => (value ? value.toNumber() : null);
const colombiaDate = (date: Date | null): string | null =>
  date
    ? new Date(date.getTime() - 5 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19)
    : null;

const PAID_STATUSES = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'REFUNDED',
  'CANCELLED',
] as const;

/** Consultas de solo lectura para métricas y exportaciones. */
@Injectable()
export class PrismaReportsReader implements ReportsReader {
  constructor(private readonly db: PrismaClientProvider) {}

  async metrics(range: DateRange) {
    const client = this.db.client;
    // "Pagado en el rango": tuvo pago confirmado (paidAt), aunque luego se haya reembolsado.
    const paidWhere: Prisma.OrderWhereInput = {
      paidAt: { gte: range.from, lt: range.to },
      status: { in: [...PAID_STATUSES] },
    };
    const [paid, refunds, byStatus, byDay, top, awaiting, invoices, review, unpaid, stock] =
      await Promise.all([
        client.order.aggregate({
          where: paidWhere,
          _count: true,
          _sum: { grandTotal: true, taxTotal: true, shippingTotal: true, discountTotal: true },
        }),
        client.refund.aggregate({
          where: { status: 'APPROVED', updatedAt: { gte: range.from, lt: range.to } },
          _sum: { amount: true },
        }),
        client.order.groupBy({
          by: ['status'],
          where: { createdAt: { gte: range.from, lt: range.to } },
          _count: true,
        }),
        client.$queryRaw<{ day: string; orders: number; revenue: Prisma.Decimal }[]>`
        SELECT to_char(("paidAt" AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') AS "day",
               COUNT(*)::int AS "orders", SUM("grandTotal") AS "revenue"
        FROM "Order"
        WHERE "paidAt" >= ${range.from} AND "paidAt" < ${range.to}
        GROUP BY 1 ORDER BY 1`,
        client.$queryRaw<
          { productName: string; sku: string; quantity: number; revenue: Prisma.Decimal }[]
        >`
        SELECT i."productName", i."sku", SUM(i."quantity")::int AS "quantity", SUM(i."lineTotal") AS "revenue"
        FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
        WHERE o."paidAt" >= ${range.from} AND o."paidAt" < ${range.to}
        GROUP BY i."productName", i."sku"
        ORDER BY "quantity" DESC, "revenue" DESC
        LIMIT 10`,
        client.order.count({ where: { status: { in: ['PAID', 'PROCESSING'] } } }),
        client.order.count({
          where: {
            invoiceNumber: null,
            status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
          },
        }),
        client.payment.count({ where: { reviewReason: { not: null }, status: 'APPROVED' } }),
        client.order.count({ where: { status: 'PENDING_PAYMENT' } }),
        client.$queryRaw<{ low: number; out: number }[]>`
        SELECT
          COUNT(*) FILTER (WHERE avail > 0 AND avail <= threshold)::int AS "low",
          COUNT(*) FILTER (WHERE avail <= 0)::int AS "out"
        FROM (
          SELECT coalesce(i."quantityOnHand", 0) - coalesce(i."quantityReserved", 0) AS avail,
                 coalesce(i."lowStockThreshold", 3) AS threshold
          FROM "ProductVariant" v
          JOIN "Product" p ON p."id" = v."productId"
          LEFT JOIN "Inventory" i ON i."variantId" = v."id"
          WHERE v."isActive" AND p."status" = 'ACTIVE'
        ) s`,
      ]);

    const [customersTotal, customersNew, lowStock, newMessages] = await Promise.all([
      client.user.count({ where: { roles: { some: { role: { name: 'customer' } } } } }),
      client.user.count({
        where: {
          roles: { some: { role: { name: 'customer' } } },
          createdAt: { gte: range.from, lt: range.to },
        },
      }),
      client.$queryRaw<
        {
          variantId: string;
          productName: string;
          variantName: string;
          sku: string;
          available: number;
          threshold: number;
        }[]
      >`
        SELECT v."id" AS "variantId", p."name" AS "productName", v."name" AS "variantName", v."sku",
               (coalesce(i."quantityOnHand", 0) - coalesce(i."quantityReserved", 0))::int AS "available",
               coalesce(i."lowStockThreshold", 3)::int AS "threshold"
        FROM "ProductVariant" v
        JOIN "Product" p ON p."id" = v."productId"
        LEFT JOIN "Inventory" i ON i."variantId" = v."id"
        WHERE v."isActive" AND p."status" = 'ACTIVE'
          AND coalesce(i."quantityOnHand", 0) - coalesce(i."quantityReserved", 0) <= coalesce(i."lowStockThreshold", 3)
        ORDER BY "available" ASC, p."name" ASC
        LIMIT 20`,
      client.contactMessage.count({ where: { status: 'NEW' } }),
    ]);

    return {
      customers: { total: customersTotal, newInRange: customersNew },
      lowStock,
      sales: {
        paidOrders: paid._count,
        revenueCents: cents(paid._sum.grandTotal),
        taxCents: cents(paid._sum.taxTotal),
        shippingCents: cents(paid._sum.shippingTotal),
        discountCents: cents(paid._sum.discountTotal),
        refundedCents: cents(refunds._sum.amount),
      },
      ordersByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
      salesByDay: byDay.map((row) => ({
        day: row.day,
        orders: row.orders,
        revenueCents: cents(row.revenue),
      })),
      topProducts: top.map((row) => ({
        productName: row.productName,
        sku: row.sku,
        quantity: row.quantity,
        revenueCents: cents(row.revenue),
      })),
      operations: {
        awaitingFulfillment: awaiting,
        pendingInvoices: invoices,
        paymentsNeedingReview: review,
        unpaidOrders: unpaid,
        lowStockVariants: stock[0]?.low ?? 0,
        outOfStockVariants: stock[0]?.out ?? 0,
        newContactMessages: newMessages,
      },
    };
  }

  async orders(range: DateRange, limit: number): Promise<ExportRow[]> {
    const rows = await this.db.client.order.findMany({
      where: { createdAt: { gte: range.from, lt: range.to } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        payments: {
          where: { status: { in: ['APPROVED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
          take: 1,
        },
        shippingMethod: { select: { name: true } },
        coupon: { select: { code: true } },
      },
    });
    return rows.map((order) => {
      const address = (order.shippingAddressSnapshot ?? {}) as Record<string, unknown>;
      return {
        pedido: order.orderNumber,
        fecha: colombiaDate(order.createdAt),
        estado: order.status,
        pagado: colombiaDate(order.paidAt),
        cliente: order.customerName,
        correo: order.customerEmail,
        tipo_documento: order.customerDocumentType,
        documento: order.customerDocumentNumber,
        municipio: typeof address['city'] === 'string' ? address['city'] : null,
        departamento: typeof address['department'] === 'string' ? address['department'] : null,
        codigo_dane: typeof address['cityDaneCode'] === 'string' ? address['cityDaneCode'] : null,
        subtotal: pesos(order.subtotal),
        descuento: pesos(order.discountTotal),
        cupon: order.coupon?.code ?? null,
        envio: pesos(order.shippingTotal),
        metodo_envio: order.shippingMethod?.name ?? null,
        iva_incluido: pesos(order.taxTotal),
        total: pesos(order.grandTotal),
        medio_pago: order.payments[0]?.paymentMethodType ?? null,
        factura: order.invoiceNumber,
        cufe: order.invoiceCufe,
      };
    });
  }

  async orderItems(range: DateRange, limit: number): Promise<ExportRow[]> {
    const rows = await this.db.client.orderItem.findMany({
      where: { order: { paidAt: { gte: range.from, lt: range.to } } },
      include: {
        order: { select: { orderNumber: true, paidAt: true, status: true, invoiceNumber: true } },
      },
      orderBy: [{ order: { paidAt: 'asc' } }, { productName: 'asc' }],
      take: limit,
    });
    return rows.map((item) => ({
      pedido: item.order.orderNumber,
      pagado: colombiaDate(item.order.paidAt),
      estado_pedido: item.order.status,
      factura: item.order.invoiceNumber,
      sku: item.sku,
      producto: item.productName,
      variante: item.variantName,
      cantidad: item.quantity,
      precio_unitario: pesos(item.unitPrice),
      descuento: pesos(item.discountTotal),
      total_linea: pesos(item.lineTotal),
      tarifa_iva: item.taxRate.toNumber(),
      iva_incluido: pesos(item.taxTotal),
      base_gravable: item.lineTotal.minus(item.taxTotal).toNumber(),
    }));
  }

  async systemSignals(now: Date): Promise<SystemSignals> {
    const client = this.db.client;
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const tenMinutesAgo = new Date(now.getTime() - 600_000);
    const [
      failedWebhooks,
      invalidSignatures24h,
      stalePendingPayments,
      overdueUnpaidOrders,
      paymentsNeedingReview,
    ] = await Promise.all([
      client.webhookEvent.count({ where: { processedAt: null, processingError: { not: null } } }),
      client.webhookEvent.count({ where: { signatureValid: false, receivedAt: { gte: dayAgo } } }),
      client.payment.count({
        where: { status: 'PENDING', providerReference: { not: null }, updatedAt: { lt: hourAgo } },
      }),
      client.order.count({
        where: { status: 'PENDING_PAYMENT', paymentDueAt: { lt: tenMinutesAgo } },
      }),
      client.payment.count({ where: { reviewReason: { not: null }, status: 'APPROVED' } }),
    ]);
    return {
      failedWebhooks,
      invalidSignatures24h,
      stalePendingPayments,
      overdueUnpaidOrders,
      paymentsNeedingReview,
    };
  }

  async inventory(limit: number): Promise<ExportRow[]> {
    return this.db.client.$queryRaw<ExportRow[]>`
      SELECT v."sku" AS "sku", p."name" AS "producto", v."name" AS "variante",
             p."status"::text AS "estado_producto", v."isActive" AS "variante_activa",
             coalesce(i."quantityOnHand", 0) AS "existencias",
             coalesce(i."quantityReserved", 0) AS "apartadas",
             coalesce(i."quantityOnHand", 0) - coalesce(i."quantityReserved", 0) AS "disponibles",
             coalesce(i."lowStockThreshold", 3) AS "umbral",
             v."price"::float AS "precio"
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      LEFT JOIN "Inventory" i ON i."variantId" = v."id"
      ORDER BY p."name", v."name"
      LIMIT ${limit}`;
  }
}
