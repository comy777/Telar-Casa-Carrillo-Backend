import { BusinessRuleViolation } from '../../../shared/domain/errors';
import { requirePriceCents } from '../../catalog/domain/money';

export type DiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';

export interface CouponProps {
  id: string;
  code: string;
  description: string | null;
  discountType: DiscountType;
  /** PERCENTAGE: porcentaje en centésimas (1000 = 10 %). FIXED_AMOUNT: centavos. */
  value: number;
  minimumSubtotalCents: number | null;
  maxDiscountCents: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  usageCount: number;
}

export type CouponInput = Omit<CouponProps, 'id' | 'usageCount'>;

const CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/;

/** Los códigos no distinguen mayúsculas: " navidad10 " → "NAVIDAD10". */
export function normalizeCouponCode(code: string): string {
  const value = code.trim().toUpperCase();
  if (!CODE_PATTERN.test(value)) {
    throw new BusinessRuleViolation(
      'El código del cupón admite de 3 a 30 letras, dígitos, guion y guion bajo',
      'INVALID_COUPON_CODE',
    );
  }
  return value;
}

const positiveOrNull = (value: number | null, field: string): number | null => {
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new BusinessRuleViolation(
      `El campo ${field} debe ser un entero positivo`,
      'INVALID_FIELD',
      {
        field,
      },
    );
  }
  return value;
};

export function validateCoupon(input: CouponInput): CouponInput {
  if (input.discountType === 'PERCENTAGE') {
    if (!Number.isInteger(input.value) || input.value <= 0 || input.value > 10_000) {
      throw new BusinessRuleViolation(
        'El porcentaje debe ser mayor que 0 y hasta 100',
        'INVALID_COUPON_VALUE',
      );
    }
  } else if (input.value <= 0) {
    throw new BusinessRuleViolation(
      'El valor del cupón debe ser mayor que 0',
      'INVALID_COUPON_VALUE',
    );
  } else {
    requirePriceCents(input.value, 'valor');
  }
  if (input.minimumSubtotalCents !== null) requirePriceCents(input.minimumSubtotalCents, 'mínimo');
  if (input.maxDiscountCents !== null) requirePriceCents(input.maxDiscountCents, 'tope');
  if (input.startsAt && input.expiresAt && input.startsAt >= input.expiresAt) {
    throw new BusinessRuleViolation(
      'La fecha de inicio debe ser anterior al vencimiento',
      'INVALID_COUPON_DATES',
    );
  }
  return {
    ...input,
    code: normalizeCouponCode(input.code),
    description: input.description?.trim() || null,
    usageLimit: positiveOrNull(input.usageLimit, 'límite de usos'),
    perCustomerLimit: positiveOrNull(input.perCustomerLimit, 'límite por cliente'),
  };
}

export interface RedemptionCounts {
  total: number;
  forCustomer: number;
}

/**
 * Descuento (en centavos) que da el cupón sobre el subtotal de productos, o un
 * error con el motivo. El descuento nunca supera el subtotal.
 */
export function discountFor(
  coupon: CouponProps,
  subtotalCents: number,
  now: Date,
  counts: RedemptionCounts,
): number {
  const fail = (message: string, code: string, details?: Record<string, unknown>) => {
    throw new BusinessRuleViolation(message, code, details);
  };
  if (!coupon.isActive) fail('El cupón no está activo', 'COUPON_INACTIVE');
  if (coupon.startsAt && now < coupon.startsAt)
    fail('El cupón aún no está vigente', 'COUPON_NOT_STARTED');
  if (coupon.expiresAt && now >= coupon.expiresAt) fail('El cupón venció', 'COUPON_EXPIRED');
  if (coupon.minimumSubtotalCents !== null && subtotalCents < coupon.minimumSubtotalCents) {
    fail('El pedido no alcanza el mínimo del cupón', 'COUPON_MINIMUM_NOT_MET', {
      minimumSubtotal: coupon.minimumSubtotalCents / 100,
    });
  }
  if (coupon.usageLimit !== null && counts.total >= coupon.usageLimit) {
    fail('El cupón ya alcanzó su límite de usos', 'COUPON_USAGE_LIMIT');
  }
  if (coupon.perCustomerLimit !== null && counts.forCustomer >= coupon.perCustomerLimit) {
    fail('Ya usaste este cupón el máximo de veces', 'COUPON_CUSTOMER_LIMIT');
  }

  let discount =
    coupon.discountType === 'PERCENTAGE'
      ? Math.floor((subtotalCents * coupon.value) / 10_000)
      : coupon.value;
  if (coupon.maxDiscountCents !== null) discount = Math.min(discount, coupon.maxDiscountCents);
  return Math.min(discount, subtotalCents);
}
