import type { DomainError } from '../../../shared/domain/errors';
import { availabilityOf, availableQuantity } from '../../../shared/domain/stock-availability';
import { normalizeReservationLines } from '../../inventory/domain/stock';
import { Cart, MAX_LINES_PER_CART, MAX_QUANTITY_PER_LINE } from './cart';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as DomainError).code;
  }
  throw new Error('No lanzó error');
};

describe('Cart', () => {
  it('suma cantidades de la misma variante y respeta el máximo por línea', () => {
    const cart = Cart.forUser('u1');
    cart.add('v1', 4);
    cart.add('v1', 3);
    expect(cart.quantityOf('v1')).toBe(7);
    expect(codeOf(() => cart.add('v1', MAX_QUANTITY_PER_LINE))).toBe('QUANTITY_LIMIT_EXCEEDED');
    expect(cart.quantityOf('v1')).toBe(7);
  });

  it('limita la cantidad de productos distintos', () => {
    const cart = Cart.forUser('u1');
    for (let i = 0; i < MAX_LINES_PER_CART; i += 1) cart.add(`v${i}`, 1);
    expect(codeOf(() => cart.add('otra', 1))).toBe('CART_FULL');
  });

  it('al incorporar el carrito de invitado suma sin pasar los límites', () => {
    const user = Cart.forUser('u1');
    user.add('v1', 8);
    const guest = Cart.forGuest('hash', new Date());
    guest.add('v1', 5);
    guest.add('v2', 2);
    user.absorb(guest);
    expect(user.lines).toEqual([
      { variantId: 'v1', quantity: MAX_QUANTITY_PER_LINE },
      { variantId: 'v2', quantity: 2 },
    ]);
  });

  it('quitar es idempotente y cambiar exige que la línea exista', () => {
    const cart = Cart.forUser('u1');
    cart.remove('v1');
    expect(() => cart.setQuantity('v1', 1)).toThrow(/no existe/);
  });

  it('solo los carritos de invitado vencen', () => {
    const user = Cart.forUser('u1');
    user.renewGuestExpiry(new Date());
    expect(user.toSnapshot().expiresAt).toBeNull();
  });
});

describe('reservas', () => {
  it('agrupa líneas repetidas y las ordena por variante (evita deadlocks)', () => {
    expect(
      normalizeReservationLines([
        { variantId: 'b', quantity: 1 },
        { variantId: 'a', quantity: 2 },
        { variantId: 'b', quantity: 3 },
      ]),
    ).toEqual([
      { variantId: 'a', quantity: 2 },
      { variantId: 'b', quantity: 4 },
    ]);
  });

  it('rechaza cantidades no positivas', () => {
    expect(codeOf(() => normalizeReservationLines([{ variantId: 'a', quantity: 0 }]))).toBe(
      'INVALID_QUANTITY',
    );
  });
});

describe('disponibilidad', () => {
  it.each([
    [{ quantityOnHand: 10, quantityReserved: 2, lowStockThreshold: 3 }, 8, 'IN_STOCK'],
    [{ quantityOnHand: 5, quantityReserved: 2, lowStockThreshold: 3 }, 3, 'LOW_STOCK'],
    [{ quantityOnHand: 2, quantityReserved: 2, lowStockThreshold: 3 }, 0, 'OUT_OF_STOCK'],
  ])('%o → %i disponibles (%s)', (level, available, availability) => {
    expect(availableQuantity(level)).toBe(available);
    expect(availabilityOf(available, level.lowStockThreshold)).toBe(availability);
  });

  it('sin inventario no hay unidades', () => {
    expect(availableQuantity(null)).toBe(0);
  });
});
