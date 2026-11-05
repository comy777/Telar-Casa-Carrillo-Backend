import { BusinessRuleViolation } from '../../../shared/domain/errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 254;

/** Correo normalizado (sin espacios y en minúsculas): dos mayúsculas distintas no crean dos cuentas. */
export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Email {
    const value = raw.trim().toLowerCase();
    if (value.length > MAX_LENGTH || !EMAIL_PATTERN.test(value)) {
      throw new BusinessRuleViolation('El correo no es válido', 'INVALID_EMAIL');
    }
    return new Email(value);
  }

  equals(other: Email): boolean {
    return other.value === this.value;
  }

  toString(): string {
    return this.value;
  }
}
