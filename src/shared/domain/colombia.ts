import { BusinessRuleViolation } from './errors';

/**
 * Departamentos de Colombia con su código DANE (DIVIPOLA). El código de un
 * municipio tiene 5 dígitos y empieza por el de su departamento
 * (p. ej. 44001 = Riohacha, La Guajira).
 */
export const DEPARTMENTS: Readonly<Record<string, string>> = {
  '05': 'Antioquia',
  '08': 'Atlántico',
  '11': 'Bogotá, D.C.',
  '13': 'Bolívar',
  '15': 'Boyacá',
  '17': 'Caldas',
  '18': 'Caquetá',
  '19': 'Cauca',
  '20': 'Cesar',
  '23': 'Córdoba',
  '25': 'Cundinamarca',
  '27': 'Chocó',
  '41': 'Huila',
  '44': 'La Guajira',
  '47': 'Magdalena',
  '50': 'Meta',
  '52': 'Nariño',
  '54': 'Norte de Santander',
  '63': 'Quindío',
  '66': 'Risaralda',
  '68': 'Santander',
  '70': 'Sucre',
  '73': 'Tolima',
  '76': 'Valle del Cauca',
  '81': 'Arauca',
  '85': 'Casanare',
  '86': 'Putumayo',
  '88': 'Archipiélago de San Andrés, Providencia y Santa Catalina',
  '91': 'Amazonas',
  '94': 'Guainía',
  '95': 'Guaviare',
  '97': 'Vaupés',
  '99': 'Vichada',
};

/**
 * Valida el formato del código DANE del municipio y que pertenezca a un
 * departamento existente. No valida contra la lista completa de municipios.
 */
export function requireCityDaneCode(code: string): string {
  const value = code.trim();
  if (!/^\d{5}$/.test(value) || !DEPARTMENTS[value.slice(0, 2)]) {
    throw new BusinessRuleViolation(
      'El código DANE del municipio debe tener 5 dígitos y empezar por el de un departamento',
      'INVALID_DANE_CODE',
    );
  }
  return value;
}

export type IdentityDocumentType = 'CC' | 'CE' | 'NIT' | 'PP' | 'PPT' | 'TI';
export const IDENTITY_DOCUMENT_TYPES: readonly IdentityDocumentType[] = [
  'CC',
  'CE',
  'NIT',
  'PP',
  'PPT',
  'TI',
];

/** Número de documento: dígitos (y letras en pasaporte/PPT), sin puntos ni espacios. */
export function normalizeDocumentNumber(type: IdentityDocumentType, value: string): string {
  const number = value.replace(/[\s.-]/g, '').toUpperCase();
  const pattern = type === 'PP' || type === 'PPT' ? /^[A-Z0-9]{4,20}$/ : /^\d{4,15}$/;
  if (!pattern.test(number)) {
    throw new BusinessRuleViolation('El número de documento no es válido', 'INVALID_DOCUMENT', {
      type,
    });
  }
  return number;
}
