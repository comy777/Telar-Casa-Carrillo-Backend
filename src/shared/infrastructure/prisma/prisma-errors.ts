import { Prisma } from '@prisma/client';

/**
 * Si el error es una violación de unicidad (P2002), devuelve los campos
 * involucrados; si no, null.
 */
export function uniqueViolationFields(error: unknown): string[] | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }
  const target = error.meta?.['target'];
  if (Array.isArray(target)) return target.map(String);
  return typeof target === 'string' ? [target] : [];
}
