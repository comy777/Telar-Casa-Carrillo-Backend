import { Prisma } from '@prisma/client';

/** Decimal(12, 2) en pesos ↔ centavos enteros del dominio. */
export const decimalToCents = (value: Prisma.Decimal): number =>
  Math.round(value.mul(100).toNumber());

export const centsToDecimal = (cents: number): Prisma.Decimal => new Prisma.Decimal(cents).div(100);

/** Decimal(5, 4) (0.1900) ↔ diezmilésimas (1900). */
export const decimalToBasisPoints = (value: Prisma.Decimal): number =>
  Math.round(value.mul(10_000).toNumber());

export const basisPointsToDecimal = (basisPoints: number): Prisma.Decimal =>
  new Prisma.Decimal(basisPoints).div(10_000);

/** Los atributos de variante se guardan como JSON; se aceptan solo pares texto-texto. */
export function toAttributes(value: Prisma.JsonValue | null): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}
