/**
 * Cálculo del pedido en centavos enteros. Los precios publicados incluyen IVA
 * (venta al consumidor): el impuesto se desglosa, no se suma.
 *
 *   subtotal  = Σ precio × cantidad
 *   total     = subtotal − descuento + envío
 *   IVA       = Σ IVA incluido en cada línea (ya con su parte del descuento) + IVA del envío
 */
export interface PricingLine {
  variantId: string;
  unitPriceCents: number;
  quantity: number;
  /** Tarifa de IVA en diezmilésimas (1900 = 19 %). */
  taxRateBasisPoints: number;
}

export interface PricedLine extends PricingLine {
  grossCents: number;
  discountCents: number;
  /** Con descuento, IVA incluido. */
  totalCents: number;
  /** IVA incluido en totalCents. */
  taxCents: number;
}

export interface OrderTotals {
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  shippingTaxCents: number;
  taxCents: number;
  grandTotalCents: number;
}

/** IVA contenido en un monto que ya lo incluye: monto × t / (1 + t). */
export const includedTax = (amountCents: number, basisPoints: number): number =>
  Math.round((amountCents * basisPoints) / (10_000 + basisPoints));

/**
 * Reparte el descuento entre las líneas en proporción a su valor, sin perder
 * centavos: el resto del redondeo va a las líneas con mayor fracción.
 */
export function allocateDiscount(grossCents: number[], discountCents: number): number[] {
  const total = grossCents.reduce((sum, value) => sum + value, 0);
  if (total === 0 || discountCents === 0) return grossCents.map(() => 0);
  const exact = grossCents.map((gross) => (gross * discountCents) / total);
  const shares = exact.map(Math.floor);
  let remainder = discountCents - shares.reduce((sum, value) => sum + value, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of byFraction) {
    if (remainder === 0) break;
    shares[index]! += 1;
    remainder -= 1;
  }
  return shares;
}

export function computeTotals(
  lines: PricingLine[],
  discountCents: number,
  shippingCents: number,
  shippingTaxBasisPoints: number,
): OrderTotals {
  const gross = lines.map((line) => line.unitPriceCents * line.quantity);
  const subtotalCents = gross.reduce((sum, value) => sum + value, 0);
  const discount = Math.min(Math.max(0, discountCents), subtotalCents);
  const shares = allocateDiscount(gross, discount);

  const priced = lines.map((line, index): PricedLine => {
    const totalCents = gross[index]! - shares[index]!;
    return {
      ...line,
      grossCents: gross[index]!,
      discountCents: shares[index]!,
      totalCents,
      taxCents: includedTax(totalCents, line.taxRateBasisPoints),
    };
  });
  const shippingTaxCents = includedTax(shippingCents, shippingTaxBasisPoints);
  return {
    lines: priced,
    subtotalCents,
    discountCents: discount,
    shippingCents,
    shippingTaxCents,
    taxCents: priced.reduce((sum, line) => sum + line.taxCents, 0) + shippingTaxCents,
    grandTotalCents: subtotalCents - discount + shippingCents,
  };
}
