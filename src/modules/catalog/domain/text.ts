import { BusinessRuleViolation } from '../../../shared/domain/errors';

/** Límites de texto del catálogo (los DTO usan los mismos valores). */
export const TEXT_LIMITS = {
  name: 150,
  sku: 64,
  shortDescription: 300,
  description: 10_000,
  seoTitle: 70,
  seoDescription: 160,
  altText: 200,
  biography: 2_000,
  story: 10_000,
  categoryDescription: 1_000,
  variantName: 100,
  materialName: 60,
} as const;

/** Texto obligatorio: se recorta y no puede quedar vacío ni superar el máximo. */
export function requiredText(value: string, field: string, max: number): string {
  const text = value.trim();
  if (!text) {
    throw new BusinessRuleViolation(`El campo ${field} es obligatorio`, 'FIELD_REQUIRED', {
      field,
    });
  }
  if (text.length > max) {
    throw new BusinessRuleViolation(
      `El campo ${field} no puede superar ${max} caracteres`,
      'FIELD_TOO_LONG',
      { field, max },
    );
  }
  return text;
}

/** Texto opcional: vacío o solo espacios se guarda como null. */
export function optionalText(
  value: string | null | undefined,
  field: string,
  max: number,
): string | null {
  const text = value?.trim();
  if (!text) return null;
  return requiredText(text, field, max);
}

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

/** Referencia interna: mayúsculas, dígitos, punto, guion y guion bajo. */
export function normalizeSku(value: string, field = 'sku'): string {
  const sku = requiredText(value, field, TEXT_LIMITS.sku).toUpperCase();
  if (!SKU_PATTERN.test(sku)) {
    throw new BusinessRuleViolation(
      'El SKU solo admite letras, dígitos, punto, guion y guion bajo',
      'INVALID_SKU',
      { field },
    );
  }
  return sku;
}
