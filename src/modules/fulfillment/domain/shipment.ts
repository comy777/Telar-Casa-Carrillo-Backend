import { BusinessRuleViolation } from '../../../shared/domain/errors';

export type ShipmentStatus =
  'PENDING' | 'READY' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'RETURNED';

export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  'PENDING',
  'READY',
  'IN_TRANSIT',
  'DELIVERED',
  'FAILED',
  'RETURNED',
];

/** FAILED = intento de entrega fallido (puede reintentarse); RETURNED = volvió al taller. */
const TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  PENDING: ['READY', 'IN_TRANSIT', 'FAILED'],
  READY: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED'],
  FAILED: ['IN_TRANSIT', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  RETURNED: [],
};

export function assertShipmentTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BusinessRuleViolation(
      `Un envío ${from} no puede pasar a ${to}`,
      'INVALID_SHIPMENT_TRANSITION',
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
}

/** Texto libre de la transportadora y guía: recortados y con límite. */
export function cleanText(value: string | null | undefined, max: number): string | null {
  const text = value?.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}
