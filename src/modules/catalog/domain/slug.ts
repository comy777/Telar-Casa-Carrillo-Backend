import { BusinessRuleViolation } from '../../../shared/domain/errors';

export const SLUG_MAX_LENGTH = 120;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Mochila Wayuu Ñapa" → "mochila-wayuu-napa". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}

/**
 * Slug para URLs públicas: el indicado explícitamente (debe tener ya el formato)
 * o uno derivado del nombre.
 */
export function resolveSlug(explicit: string | null | undefined, name: string): string {
  const slug = explicit?.trim() ? explicit.trim() : slugify(name);
  if (!slug || slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw new BusinessRuleViolation(
      'El slug solo admite minúsculas, dígitos y guiones (p. ej. "mochila-wayuu")',
      'INVALID_SLUG',
    );
  }
  return slug;
}
