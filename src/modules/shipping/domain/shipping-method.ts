import { BusinessRuleViolation } from '../../../shared/domain/errors';
import { requirePriceCents } from '../../catalog/domain/money';

export interface ShippingMethodProps {
  id: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  /** Envío gratis desde este subtotal (IVA incluido). */
  freeShippingThresholdCents: number | null;
  estimatedDelivery: string | null;
  isActive: boolean;
  sortOrder: number;
}

export type ShippingMethodInput = Omit<ShippingMethodProps, 'id'>;

function requireText(value: string, field: string, max: number): string {
  const text = value.trim();
  if (!text || text.length > max) {
    throw new BusinessRuleViolation(
      `El campo ${field} es obligatorio y admite hasta ${max} caracteres`,
      'INVALID_FIELD',
      { field },
    );
  }
  return text;
}

export function validateShippingMethod(input: ShippingMethodInput): ShippingMethodInput {
  requirePriceCents(input.basePriceCents, 'costo de envío');
  if (input.freeShippingThresholdCents !== null) {
    requirePriceCents(input.freeShippingThresholdCents, 'umbral de envío gratis');
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
    throw new BusinessRuleViolation('El orden debe ser un entero positivo', 'INVALID_ORDER');
  }
  return {
    ...input,
    name: requireText(input.name, 'nombre', 100),
    description: input.description?.trim() || null,
    estimatedDelivery: input.estimatedDelivery?.trim() || null,
  };
}

/** Costo del envío para un subtotal de productos (ya con descuento), IVA incluido. */
export function shippingCostFor(method: ShippingMethodProps, subtotalCents: number): number {
  const threshold = method.freeShippingThresholdCents;
  return threshold !== null && subtotalCents >= threshold ? 0 : method.basePriceCents;
}
