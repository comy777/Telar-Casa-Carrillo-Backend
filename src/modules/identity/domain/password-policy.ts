import { BusinessRuleViolation } from '../../../shared/domain/errors';

export const PASSWORD_MIN_LENGTH = 10;
/** Límite superior para que nadie envíe textos enormes al algoritmo de hash. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Política basada en longitud (recomendación NIST SP 800-63B): sin reglas de
 * mayúsculas/símbolos, que empujan a contraseñas predecibles.
 */
export function assertPasswordAllowed(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new BusinessRuleViolation(
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`,
      'PASSWORD_TOO_SHORT',
    );
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new BusinessRuleViolation(
      `La contraseña no puede tener más de ${PASSWORD_MAX_LENGTH} caracteres`,
      'PASSWORD_TOO_LONG',
    );
  }
  if (new Set(password).size === 1) {
    throw new BusinessRuleViolation(
      'La contraseña no puede ser un solo carácter repetido',
      'PASSWORD_TOO_WEAK',
    );
  }
}
