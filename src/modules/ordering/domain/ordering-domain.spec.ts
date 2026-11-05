import { requireCityDaneCode, normalizeDocumentNumber } from '../../../shared/domain/colombia';
import type { DomainError } from '../../../shared/domain/errors';
import { discountFor, type CouponProps, validateCoupon } from '../../promotions/domain/coupon';
import { toPostalAddress } from '../../shipping/domain/address';
import { shippingCostFor } from '../../shipping/domain/shipping-method';
import { assertManualTransition, assertTransition, formatOrderNumber } from './order-status';
import { allocateDiscount, computeTotals, includedTax } from './pricing';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as DomainError).code;
  }
  throw new Error('No lanzó error');
};

describe('pricing', () => {
  it('desglosa el IVA incluido en el precio', () => {
    // 119.000 con IVA del 19 % → 19.000 de IVA.
    expect(includedTax(11_900_000, 1900)).toBe(1_900_000);
    expect(includedTax(10_000_000, 0)).toBe(0);
  });

  it('reparte el descuento sin perder centavos', () => {
    const shares = allocateDiscount([100, 100, 100], 100);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([34, 33, 33]);
    expect(allocateDiscount([500, 0], 0)).toEqual([0, 0]);
  });

  it('calcula subtotal, descuento, envío, IVA y total', () => {
    const totals = computeTotals(
      [
        { variantId: 'a', unitPriceCents: 11_900_000, quantity: 2, taxRateBasisPoints: 1900 },
        { variantId: 'b', unitPriceCents: 5_000_000, quantity: 1, taxRateBasisPoints: 0 },
      ],
      2_880_000,
      1_190_000,
      1900,
    );
    expect(totals).toMatchObject({
      subtotalCents: 28_800_000,
      discountCents: 2_880_000,
      shippingCents: 1_190_000,
      shippingTaxCents: 190_000,
      grandTotalCents: 27_110_000,
    });
    // El descuento se reparte 23,8 : 5 y el IVA se calcula sobre lo que queda.
    const [a, b] = totals.lines;
    expect(a!.discountCents + b!.discountCents).toBe(2_880_000);
    expect(a!.totalCents + b!.totalCents).toBe(25_920_000);
    expect(b!.taxCents).toBe(0);
    expect(totals.taxCents).toBe(a!.taxCents + 190_000);
  });

  it('el descuento nunca supera el subtotal', () => {
    const totals = computeTotals(
      [{ variantId: 'a', unitPriceCents: 1_000, quantity: 1, taxRateBasisPoints: 1900 }],
      5_000,
      0,
      1900,
    );
    expect(totals).toMatchObject({ discountCents: 1_000, grandTotalCents: 0 });
  });
});

describe('estados del pedido', () => {
  it('aplica la tabla de transiciones', () => {
    expect(() => assertTransition('PENDING_PAYMENT', 'PAID')).not.toThrow();
    expect(codeOf(() => assertTransition('CANCELLED', 'PAID'))).toBe('INVALID_ORDER_TRANSITION');
    expect(codeOf(() => assertTransition('DELIVERED', 'SHIPPED'))).toBe('INVALID_ORDER_TRANSITION');
  });

  it('a mano no se marca pagado ni se cancela un pedido pagado', () => {
    expect(() => assertManualTransition('PAID', 'PROCESSING')).not.toThrow();
    expect(codeOf(() => assertManualTransition('PENDING_PAYMENT', 'PAID'))).toBe(
      'MANUAL_TRANSITION_NOT_ALLOWED',
    );
    expect(codeOf(() => assertManualTransition('PAID', 'CANCELLED'))).toBe(
      'MANUAL_TRANSITION_NOT_ALLOWED',
    );
  });

  it('formatea el número de pedido', () => {
    expect(formatOrderNumber('TCC', 123)).toBe('TCC-000123');
    expect(formatOrderNumber('TCC', 1_234_567)).toBe('TCC-1234567');
  });
});

describe('cupones', () => {
  const coupon = (overrides: Partial<CouponProps> = {}): CouponProps => ({
    id: 'c1',
    code: 'NAVIDAD10',
    description: null,
    discountType: 'PERCENTAGE',
    value: 1000,
    minimumSubtotalCents: null,
    maxDiscountCents: null,
    usageLimit: null,
    perCustomerLimit: null,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    usageCount: 0,
    ...overrides,
  });
  const now = new Date('2026-12-01T00:00:00Z');
  const none = { total: 0, forCustomer: 0 };

  it('porcentaje con tope y monto fijo sin pasar el subtotal', () => {
    expect(discountFor(coupon(), 20_000_000, now, none)).toBe(2_000_000);
    expect(discountFor(coupon({ maxDiscountCents: 1_500_000 }), 20_000_000, now, none)).toBe(
      1_500_000,
    );
    expect(
      discountFor(coupon({ discountType: 'FIXED_AMOUNT', value: 5_000_000 }), 3_000_000, now, none),
    ).toBe(3_000_000);
  });

  it.each([
    [{ isActive: false }, none, 'COUPON_INACTIVE'],
    [{ startsAt: new Date('2027-01-01') }, none, 'COUPON_NOT_STARTED'],
    [{ expiresAt: new Date('2026-11-30') }, none, 'COUPON_EXPIRED'],
    [{ minimumSubtotalCents: 50_000_000 }, none, 'COUPON_MINIMUM_NOT_MET'],
    [{ usageLimit: 5 }, { total: 5, forCustomer: 0 }, 'COUPON_USAGE_LIMIT'],
    [{ perCustomerLimit: 1 }, { total: 1, forCustomer: 1 }, 'COUPON_CUSTOMER_LIMIT'],
  ])('rechaza %o', (overrides, counts, code) => {
    expect(codeOf(() => discountFor(coupon(overrides), 20_000_000, now, counts))).toBe(code);
  });

  it('valida porcentaje, fechas y código', () => {
    const { id: _id, usageCount: _u, ...input } = coupon();
    expect(validateCoupon({ ...input, code: ' navidad10 ' }).code).toBe('NAVIDAD10');
    expect(codeOf(() => validateCoupon({ ...input, value: 10_001 }))).toBe('INVALID_COUPON_VALUE');
    expect(
      codeOf(() =>
        validateCoupon({
          ...input,
          startsAt: new Date('2027-01-02'),
          expiresAt: new Date('2027-01-01'),
        }),
      ),
    ).toBe('INVALID_COUPON_DATES');
  });
});

describe('Colombia', () => {
  it('valida el código DANE y deduce el departamento', () => {
    expect(requireCityDaneCode('44001')).toBe('44001');
    expect(codeOf(() => requireCityDaneCode('99999x'))).toBe('INVALID_DANE_CODE');
    expect(codeOf(() => requireCityDaneCode('02001'))).toBe('INVALID_DANE_CODE');
    const address = toPostalAddress({
      recipient: ' Ana  Pérez ',
      phone: '+57 300 123 4567',
      line1: 'Calle 10 # 5-23',
      city: 'Riohacha',
      cityDaneCode: '44001',
    });
    expect(address).toMatchObject({
      recipient: 'Ana Pérez',
      phone: '+573001234567',
      department: 'La Guajira',
      countryCode: 'CO',
    });
  });

  it('normaliza el número de documento', () => {
    expect(normalizeDocumentNumber('CC', '1.020.304.050')).toBe('1020304050');
    expect(normalizeDocumentNumber('PP', 'ab123456')).toBe('AB123456');
    expect(codeOf(() => normalizeDocumentNumber('CC', 'ABC'))).toBe('INVALID_DOCUMENT');
  });
});

describe('envío', () => {
  const method = {
    id: 'm',
    name: 'Nacional',
    description: null,
    basePriceCents: 1_500_000,
    freeShippingThresholdCents: 30_000_000,
    estimatedDelivery: null,
    isActive: true,
    sortOrder: 0,
  };

  it('es gratis desde el umbral', () => {
    expect(shippingCostFor(method, 29_999_999)).toBe(1_500_000);
    expect(shippingCostFor(method, 30_000_000)).toBe(0);
    expect(shippingCostFor({ ...method, freeShippingThresholdCents: null }, 99_000_000)).toBe(
      1_500_000,
    );
  });
});
