import { DEPARTMENTS, requireCityDaneCode } from '../../../shared/domain/colombia';
import { BusinessRuleViolation } from '../../../shared/domain/errors';

export const MAX_ADDRESSES_PER_USER = 10;

/** Dirección de envío en Colombia, ya validada. También es el snapshot del pedido. */
export interface PostalAddress {
  recipient: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  /** Se deriva del código DANE. */
  department: string;
  cityDaneCode: string;
  postalCode: string | null;
  countryCode: 'CO';
}

export interface AddressInput {
  recipient: string;
  phone: string;
  line1: string;
  line2?: string | null | undefined;
  city: string;
  cityDaneCode: string;
  postalCode?: string | null | undefined;
}

function text(value: string | null | undefined, field: string, max: number): string {
  const result = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!result) {
    throw new BusinessRuleViolation(`El campo ${field} es obligatorio`, 'FIELD_REQUIRED', {
      field,
    });
  }
  if (result.length > max) {
    throw new BusinessRuleViolation(
      `El campo ${field} no puede superar ${max} caracteres`,
      'FIELD_TOO_LONG',
      { field, max },
    );
  }
  return result;
}

/** Teléfono para la transportadora: 7 a 15 dígitos, con + opcional. */
export function normalizePhone(value: string): string {
  const phone = value.replace(/[\s()-]/g, '');
  if (!/^\+?\d{7,15}$/.test(phone)) {
    throw new BusinessRuleViolation('El teléfono no es válido', 'INVALID_PHONE');
  }
  return phone;
}

export function toPostalAddress(input: AddressInput): PostalAddress {
  const cityDaneCode = requireCityDaneCode(input.cityDaneCode);
  const postalCode = input.postalCode?.trim() || null;
  if (postalCode && !/^\d{6}$/.test(postalCode)) {
    throw new BusinessRuleViolation('El código postal tiene 6 dígitos', 'INVALID_POSTAL_CODE');
  }
  return {
    recipient: text(input.recipient, 'destinatario', 120),
    phone: normalizePhone(input.phone),
    line1: text(input.line1, 'dirección', 200),
    line2: input.line2?.trim() ? text(input.line2, 'complemento', 200) : null,
    city: text(input.city, 'municipio', 100),
    department: DEPARTMENTS[cityDaneCode.slice(0, 2)]!,
    cityDaneCode,
    postalCode,
    countryCode: 'CO',
  };
}

export interface SavedAddress extends PostalAddress {
  id: string;
  userId: string;
  label: string | null;
  isDefault: boolean;
}

export function normalizeLabel(label: string | null | undefined): string | null {
  return label?.trim() ? text(label, 'nombre de la dirección', 40) : null;
}
