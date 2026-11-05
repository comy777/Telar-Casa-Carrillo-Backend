import { BusinessRuleViolation } from '../../../shared/domain/errors';

export type OrderStatus =
  'PENDING_PAYMENT' | 'PAID' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
];

/** Tabla de transiciones de docs/domain-model.md (validar con el negocio). */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Transiciones que el administrador hace a mano. Las demás tienen su propio
 * flujo: PAID lo confirma la pasarela; cancelar un pedido pagado y REFUNDED
 * exigen un reembolso (módulo de pagos).
 */
export const MANUAL_TRANSITIONS: Readonly<Partial<Record<OrderStatus, readonly OrderStatus[]>>> = {
  PENDING_PAYMENT: ['CANCELLED'],
  PAID: ['PROCESSING'],
  PROCESSING: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
};

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    throw new BusinessRuleViolation(
      `Un pedido ${from} no puede pasar a ${to}`,
      'INVALID_ORDER_TRANSITION',
      { from, to, allowed: ORDER_TRANSITIONS[from] },
    );
  }
}

export function assertManualTransition(from: OrderStatus, to: OrderStatus): void {
  assertTransition(from, to);
  if (!MANUAL_TRANSITIONS[from]?.includes(to)) {
    throw new BusinessRuleViolation(
      'Este cambio de estado lo hace el flujo de pagos o reembolsos',
      'MANUAL_TRANSITION_NOT_ALLOWED',
      { from, to },
    );
  }
}

/** Ya se cobró: cancelar o devolver exige reembolso. */
export const isPaidStatus = (status: OrderStatus): boolean =>
  ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(status);

export const formatOrderNumber = (prefix: string, sequence: number): string =>
  `${prefix}-${String(sequence).padStart(6, '0')}`;
