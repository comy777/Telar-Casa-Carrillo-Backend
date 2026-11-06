import { Inject, Injectable } from '@nestjs/common';
import { BusinessRuleViolation } from '../../../shared/domain/errors';

/** Rango de fechas [from, to) ya convertido a instantes (zona horaria de Colombia). */
export interface DateRange {
  from: Date;
  to: Date;
}

export interface SalesMetrics {
  paidOrders: number;
  revenueCents: number;
  taxCents: number;
  shippingCents: number;
  discountCents: number;
  refundedCents: number;
  netRevenueCents: number;
  averageOrderCents: number;
}

export interface Metrics {
  range: DateRange;
  sales: SalesMetrics;
  ordersByStatus: Record<string, number>;
  salesByDay: { day: string; orders: number; revenueCents: number }[];
  topProducts: { productName: string; sku: string; quantity: number; revenueCents: number }[];
  /** Clientes con cuenta: total a la fecha y nuevos en el rango. */
  customers: { total: number; newInRange: number };
  /** Variantes publicadas con pocas unidades o agotadas (las 20 más urgentes). */
  lowStock: {
    variantId: string;
    productName: string;
    variantName: string;
    sku: string;
    available: number;
    threshold: number;
  }[];
  /** Pendientes a la fecha (no dependen del rango). */
  operations: {
    awaitingFulfillment: number;
    pendingInvoices: number;
    paymentsNeedingReview: number;
    unpaidOrders: number;
    lowStockVariants: number;
    outOfStockVariants: number;
    newContactMessages: number;
  };
}

export interface ExportRow {
  [column: string]: string | number | null;
}

export interface ReportsReader {
  metrics(range: DateRange): Promise<
    Omit<Metrics, 'range' | 'sales'> & {
      sales: Omit<SalesMetrics, 'netRevenueCents' | 'averageOrderCents'>;
    }
  >;
  orders(range: DateRange, limit: number): Promise<ExportRow[]>;
  orderItems(range: DateRange, limit: number): Promise<ExportRow[]>;
  inventory(limit: number): Promise<ExportRow[]>;
  /** Señales de que algo necesita atención (para monitoreo y alertas externas). */
  systemSignals(now: Date): Promise<SystemSignals>;
}

export interface SystemSignals {
  /** Notificaciones de la pasarela que fallaron al procesarse y siguen sin procesar. */
  failedWebhooks: number;
  /** Notificaciones con firma inválida en las últimas 24 h (posibles intentos de fraude). */
  invalidSignatures24h: number;
  /** Pagos pendientes en la pasarela sin novedades hace más de una hora. */
  stalePendingPayments: number;
  /** Pedidos vencidos sin cancelar (si es mayor que 0, el proceso de vencimiento no corre). */
  overdueUnpaidOrders: number;
  paymentsNeedingReview: number;
}
export const REPORTS_READER = Symbol('ReportsReader');

export const MAX_RANGE_DAYS = 366;
export const MAX_EXPORT_ROWS = 50_000;
const DAY_MS = 86_400_000;

/** Colombia no tiene horario de verano: siempre UTC−5. */
export const COLOMBIA_OFFSET = '-05:00';

/**
 * "2026-11-01".."2026-11-30" (días de Colombia, ambos incluidos) → instantes.
 * Sin fechas: los últimos 30 días.
 */
export function toRange(from: string | undefined, to: string | undefined, now: Date): DateRange {
  const day = (value: string) => new Date(`${value}T00:00:00${COLOMBIA_OFFSET}`);
  const today = new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  const end = new Date(day(to ?? today).getTime() + DAY_MS);
  const start = from ? day(from) : new Date(end.getTime() - 30 * DAY_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new BusinessRuleViolation('Rango de fechas inválido', 'INVALID_RANGE');
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new BusinessRuleViolation(
      `El rango admite hasta ${MAX_RANGE_DAYS} días`,
      'RANGE_TOO_LONG',
    );
  }
  return { from: start, to: end };
}

/**
 * CSV (RFC 4180) con BOM para que Excel lo abra en UTF-8. Las celdas que
 * empiezan por = + - @ se prefijan con ' para evitar inyección de fórmulas.
 */
/** Marca de orden de bytes: Excel la usa para detectar UTF-8. */
const BOM = String.fromCharCode(0xfeff);

export function toCsv(rows: ExportRow[], columns: string[], delimiter: ',' | ';'): string {
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    columns.join(delimiter),
    ...rows.map((row) => columns.map((c) => escape(row[c] ?? null)).join(delimiter)),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

@Injectable()
export class ReportsService {
  constructor(@Inject(REPORTS_READER) private readonly reader: ReportsReader) {}

  async metrics(range: DateRange): Promise<Metrics> {
    const data = await this.reader.metrics(range);
    const net = data.sales.revenueCents - data.sales.refundedCents;
    return {
      ...data,
      range,
      sales: {
        ...data.sales,
        netRevenueCents: net,
        averageOrderCents:
          data.sales.paidOrders > 0
            ? Math.round(data.sales.revenueCents / data.sales.paidOrders)
            : 0,
      },
    };
  }

  async export(
    kind: 'orders' | 'order-items' | 'inventory',
    range: DateRange,
    delimiter: ',' | ';',
  ): Promise<string> {
    const rows =
      kind === 'orders'
        ? await this.reader.orders(range, MAX_EXPORT_ROWS + 1)
        : kind === 'order-items'
          ? await this.reader.orderItems(range, MAX_EXPORT_ROWS + 1)
          : await this.reader.inventory(MAX_EXPORT_ROWS + 1);
    if (rows.length > MAX_EXPORT_ROWS) {
      throw new BusinessRuleViolation(
        `El reporte supera ${MAX_EXPORT_ROWS} filas: usa un rango más corto`,
        'EXPORT_TOO_LARGE',
      );
    }
    const columns = rows[0] ? Object.keys(rows[0]) : EMPTY_COLUMNS[kind];
    return toCsv(rows, columns, delimiter);
  }
}

const EMPTY_COLUMNS: Record<'orders' | 'order-items' | 'inventory', string[]> = {
  orders: ['pedido', 'fecha', 'estado', 'total'],
  'order-items': ['pedido', 'fecha', 'sku', 'producto', 'cantidad', 'total_linea'],
  inventory: ['sku', 'producto', 'variante', 'existencias', 'apartadas', 'disponibles'],
};
