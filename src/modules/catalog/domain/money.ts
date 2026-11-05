import { BusinessRuleViolation } from '../../../shared/domain/errors';

/**
 * Los montos se manejan en centavos enteros para no acumular errores de punto
 * flotante. En la base se guardan como Decimal(12, 2) en pesos.
 */
export const MAX_PRICE_CENTS = 999_999_999_999;

export function requirePriceCents(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PRICE_CENTS) {
    throw new BusinessRuleViolation(`El campo ${field} no es un precio válido`, 'INVALID_PRICE', {
      field,
    });
  }
  return value;
}

/** 185000.5 → 18500050. Redondea para absorber la representación binaria. */
export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100);
}

export function centsToPesos(cents: number): number {
  return cents / 100;
}

/** Tarifa de IVA en diezmilésimas: 0.19 → 1900. */
export function requireTaxRate(basisPoints: number): number {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new BusinessRuleViolation('La tarifa de IVA debe estar entre 0 y 1', 'INVALID_TAX_RATE');
  }
  return basisPoints;
}

export const DEFAULT_TAX_RATE = 1900;
