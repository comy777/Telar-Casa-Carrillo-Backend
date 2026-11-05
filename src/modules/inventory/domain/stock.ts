import { BusinessRuleViolation } from '../../../shared/domain/errors';

export const MAX_STOCK_QUANTITY = 1_000_000;
export const MAX_LOW_STOCK_THRESHOLD = 10_000;

export type MovementType = 'IN' | 'OUT' | 'RESERVE' | 'RELEASE' | 'ADJUSTMENT';

/** Por qué se libera una reserva (queda en el movimiento RELEASE). */
export type ReleaseReason = 'expired' | 'cart_changed' | 'checkout_cancelled' | 'cart_deleted';

export interface ReservationLine {
  variantId: string;
  quantity: number;
}

export function requirePositiveQuantity(value: number, field = 'cantidad'): number {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_STOCK_QUANTITY) {
    throw new BusinessRuleViolation(
      `El campo ${field} debe ser un entero entre 1 y ${MAX_STOCK_QUANTITY}`,
      'INVALID_QUANTITY',
      { field },
    );
  }
  return value;
}

export function requireStockCount(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_STOCK_QUANTITY) {
    throw new BusinessRuleViolation(
      `Las existencias deben ser un entero entre 0 y ${MAX_STOCK_QUANTITY}`,
      'INVALID_QUANTITY',
    );
  }
  return value;
}

export function requireThreshold(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_LOW_STOCK_THRESHOLD) {
    throw new BusinessRuleViolation(
      `El umbral debe ser un entero entre 0 y ${MAX_LOW_STOCK_THRESHOLD}`,
      'INVALID_THRESHOLD',
    );
  }
  return value;
}

/**
 * Agrupa líneas repetidas y las ordena por variante. Reservar siempre en el
 * mismo orden evita bloqueos mutuos (deadlocks) entre dos checkouts que
 * comparten variantes.
 */
export function normalizeReservationLines(lines: ReservationLine[]): ReservationLine[] {
  const totals = new Map<string, number>();
  for (const line of lines) {
    requirePositiveQuantity(line.quantity);
    totals.set(line.variantId, (totals.get(line.variantId) ?? 0) + line.quantity);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([variantId, quantity]) => ({ variantId, quantity }));
}

export interface ShortLine {
  variantId: string;
  requested: number;
  available: number;
}

export const insufficientStock = (lines: ShortLine[]) =>
  new BusinessRuleViolation(
    'No hay unidades suficientes para algunos productos',
    'INSUFFICIENT_STOCK',
    { lines },
  );
