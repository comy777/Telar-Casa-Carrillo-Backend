import { BusinessRuleViolation } from '../../../shared/domain/errors';

export type PaymentStatus =
  'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'ERROR';

/** Estados que reporta la pasarela para una transacción. */
export type GatewayStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

export type RefundStatus = 'PENDING' | 'APPROVED' | 'FAILED';

/**
 * Transiciones del pago. Las notificaciones pueden llegar desordenadas o
 * repetidas: una que no avanza el estado se registra pero no lo cambia.
 */
const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PENDING: ['APPROVED', 'DECLINED', 'VOIDED', 'ERROR'],
  APPROVED: ['VOIDED', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUNDED'],
  DECLINED: [],
  VOIDED: [],
  REFUNDED: [],
  ERROR: [],
};

export const canMovePayment = (from: PaymentStatus, to: PaymentStatus): boolean =>
  PAYMENT_TRANSITIONS[from].includes(to);

/** Motivos por los que un pago aprobado necesita revisión (y normalmente reembolso). */
export type ReviewReason =
  'ORDER_NOT_PAYABLE' | 'AMOUNT_MISMATCH' | 'STOCK_SHORTAGE' | 'DUPLICATE_PAYMENT';

/**
 * Valida un reembolso: el pago debe estar cobrado y la suma de reembolsos
 * aprobados y en curso no puede superar lo pagado.
 */
export function assertRefundable(
  payment: { status: PaymentStatus; amountCents: number },
  alreadyRefundedCents: number,
  amountCents: number,
): void {
  if (payment.status !== 'APPROVED' && payment.status !== 'PARTIALLY_REFUNDED') {
    throw new BusinessRuleViolation(
      'Solo se reembolsan pagos aprobados',
      'PAYMENT_NOT_REFUNDABLE',
      {
        status: payment.status,
      },
    );
  }
  const remaining = payment.amountCents - alreadyRefundedCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > remaining) {
    throw new BusinessRuleViolation(
      'El monto del reembolso supera lo que queda por devolver',
      'REFUND_EXCEEDS_PAYMENT',
      { remaining: remaining / 100 },
    );
  }
}

/** Estado del pago tras un reembolso aprobado. */
export const statusAfterRefunds = (amountCents: number, refundedCents: number): PaymentStatus =>
  refundedCents >= amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
