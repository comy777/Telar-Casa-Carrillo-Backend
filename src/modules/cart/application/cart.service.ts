import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import type { Availability } from '../../../shared/domain/stock-availability';
import { StockReservations } from '../../inventory/application/stock-reservations.service';
import { Cart, MAX_QUANTITY_PER_LINE } from '../domain/cart';
import {
  CART_CATALOG,
  CART_REPOSITORY,
  CART_SETTINGS,
  type CartCatalog,
  type CartRepository,
  type CartSettings,
  GUEST_CART_KEYS,
  type GuestCartKeys,
  type PurchasableVariant,
} from './ports';

/** Quién pide el carrito: usuario con sesión, invitado con cookie, o ambos (recién inició sesión). */
export interface CartIdentity {
  userId: string | null;
  guestKey: string | null;
}

export type CartIssueCode = 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK';

export interface CartIssue {
  code: CartIssueCode;
  /** Para INSUFFICIENT_STOCK: cuántas unidades se pueden comprar. */
  available?: number;
}

export interface CartLineView {
  variantId: string;
  quantity: number;
  /** null si la variante ya no existe en el catálogo. */
  product: Omit<PurchasableVariant, 'purchasable' | 'variantId'> | null;
  lineTotalCents: number;
  availability: Availability;
  /** Máximo que se puede pedir en esta línea (stock y límite por línea). */
  maxQuantity: number;
  issues: CartIssue[];
}

export interface CartView {
  id: string | null;
  lines: CartLineView[];
  itemCount: number;
  /** Suma de las líneas sin problemas, en centavos, IVA incluido. */
  subtotalCents: number;
  currency: string;
  /** Hay líneas y ninguna tiene problemas. */
  canCheckout: boolean;
  reservation: { expiresAt: Date } | null;
}

/** Qué hacer con la cookie del carrito de invitado. */
export type GuestCookie = { set: string } | 'clear' | null;

export interface CartOutcome {
  view: CartView;
  cookie: GuestCookie;
}

const EMPTY_VIEW: CartView = {
  id: null,
  lines: [],
  itemCount: 0,
  subtotalCents: 0,
  currency: 'COP',
  canCheckout: false,
  reservation: null,
};

/**
 * Carrito persistente para usuarios e invitados. Cada cambio libera la reserva
 * de checkout que hubiera (el carrito ya no es el mismo que se reservó).
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(CART_REPOSITORY) private readonly carts: CartRepository,
    @Inject(CART_CATALOG) private readonly catalog: CartCatalog,
    @Inject(GUEST_CART_KEYS) private readonly keys: GuestCartKeys,
    @Inject(CART_SETTINGS) private readonly settings: CartSettings,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly stock: StockReservations,
  ) {}

  get(identity: CartIdentity): Promise<CartOutcome> {
    return this.unitOfWork.execute(async () => {
      const { cart, cookie } = await this.resolve(identity, false);
      return { view: await this.view(cart), cookie };
    });
  }

  addItem(identity: CartIdentity, variantId: string, quantity: number): Promise<CartOutcome> {
    return this.mutate(identity, true, async (cart) => {
      await this.assertCanHold(cart, variantId, cart.quantityOf(variantId) + quantity);
      cart.add(variantId, quantity);
    });
  }

  setQuantity(identity: CartIdentity, variantId: string, quantity: number): Promise<CartOutcome> {
    return this.mutate(identity, false, async (cart) => {
      if (cart.quantityOf(variantId) === 0) {
        throw new NotFoundError('Producto en el carrito', variantId);
      }
      // Bajar la cantidad siempre se permite; subirla exige stock.
      if (quantity > cart.quantityOf(variantId)) {
        await this.assertCanHold(cart, variantId, quantity);
      }
      cart.setQuantity(variantId, quantity);
    });
  }

  removeItem(identity: CartIdentity, variantId: string): Promise<CartOutcome> {
    return this.mutate(identity, false, (cart) => {
      cart.remove(variantId);
      return Promise.resolve();
    });
  }

  clear(identity: CartIdentity): Promise<CartOutcome> {
    return this.mutate(identity, false, (cart) => {
      cart.clear();
      return Promise.resolve();
    });
  }

  /** Inicia el checkout: aparta todas las líneas por unos minutos. */
  reserve(identity: CartIdentity): Promise<CartOutcome> {
    return this.unitOfWork.execute(async () => {
      const { cart, cookie } = await this.resolve(identity, false);
      if (!cart || cart.isEmpty) {
        throw new BusinessRuleViolation('El carrito está vacío', 'CART_EMPTY');
      }
      // Se revalida sin contar la reserva anterior: se va a reemplazar.
      await this.stock.releaseForCart(cart.id, 'checkout_cancelled');
      const current = await this.view(cart);
      if (!current.canCheckout) {
        throw new BusinessRuleViolation(
          'Revisa el carrito: hay productos no disponibles o sin unidades suficientes',
          'CART_HAS_ISSUES',
          {
            lines: current.lines
              .filter((line) => line.issues.length > 0)
              .map(({ variantId, issues }) => ({ variantId, issues })),
          },
        );
      }
      await this.stock.reserveForCart(cart.id, [...cart.lines]);
      return { view: await this.view(cart), cookie };
    });
  }

  releaseReservation(identity: CartIdentity): Promise<CartOutcome> {
    return this.unitOfWork.execute(async () => {
      const { cart, cookie } = await this.resolve(identity, false);
      if (cart) await this.stock.releaseForCart(cart.id, 'checkout_cancelled');
      return { view: await this.view(cart), cookie };
    });
  }

  /** Borra carritos de invitado vencidos (liberando antes sus reservas). */
  async purgeExpiredGuestCarts(limit = 500): Promise<number> {
    const ids = await this.carts.findExpiredGuestCartIds(this.clock.now(), limit);
    for (const id of ids) {
      await this.unitOfWork.execute(async () => {
        await this.stock.releaseForCart(id, 'cart_deleted');
        await this.carts.delete(id);
      });
    }
    return ids.length;
  }

  /** Vista revalidada con precios y stock actuales (la usa también el checkout). */
  async view(cart: Cart | null): Promise<CartView> {
    if (!cart || cart.isEmpty) {
      return { ...EMPTY_VIEW, id: cart?.id ?? null };
    }
    const variantIds = cart.lines.map((line) => line.variantId);
    const [products, availability, reservation] = await Promise.all([
      this.catalog.lookup(variantIds),
      this.stock.availableFor(variantIds, cart.id),
      this.stock.activeForCart(cart.id),
    ]);

    const lines = cart.lines.map((line): CartLineView => {
      const variant = products.get(line.variantId);
      const stock = availability.get(line.variantId) ?? {
        available: 0,
        availability: 'OUT_OF_STOCK' as const,
      };
      const issues: CartIssue[] = [];
      if (!variant?.purchasable) issues.push({ code: 'UNAVAILABLE' });
      else if (stock.available <= 0) issues.push({ code: 'OUT_OF_STOCK' });
      else if (line.quantity > stock.available) {
        issues.push({ code: 'INSUFFICIENT_STOCK', available: stock.available });
      }
      const product = variant
        ? (({ purchasable: _p, variantId: _v, ...rest }) => rest)(variant)
        : null;
      return {
        variantId: line.variantId,
        quantity: line.quantity,
        product,
        lineTotalCents: (variant?.priceCents ?? 0) * line.quantity,
        availability: variant?.purchasable ? stock.availability : 'OUT_OF_STOCK',
        maxQuantity: Math.max(0, Math.min(MAX_QUANTITY_PER_LINE, stock.available)),
        issues,
      };
    });

    return {
      id: cart.id,
      lines,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      subtotalCents: lines
        .filter((line) => line.issues.length === 0)
        .reduce((sum, line) => sum + line.lineTotalCents, 0),
      currency: 'COP',
      canCheckout: lines.length > 0 && lines.every((line) => line.issues.length === 0),
      reservation: reservation ? { expiresAt: reservation.expiresAt } : null,
    };
  }

  /** Carrito actual del usuario o invitado, sin crearlo (para el checkout). */
  async current(identity: CartIdentity): Promise<{ cart: Cart | null; cookie: GuestCookie }> {
    return this.resolve(identity, false);
  }

  /** Tras crear el pedido: se vacía (sus reservas ya pasaron al pedido). */
  async emptyAfterOrder(cart: Cart): Promise<void> {
    cart.clear();
    await this.carts.save(cart);
  }

  // ---------- utilidades ----------

  private mutate(
    identity: CartIdentity,
    create: boolean,
    change: (cart: Cart) => Promise<void>,
  ): Promise<CartOutcome> {
    return this.unitOfWork.execute(async () => {
      const { cart, cookie } = await this.resolve(identity, create);
      if (!cart) return { view: EMPTY_VIEW, cookie };
      await this.stock.releaseForCart(cart.id, 'cart_changed');
      await change(cart);
      cart.renewGuestExpiry(this.guestExpiry());
      await this.carts.save(cart);
      return { view: await this.view(cart), cookie };
    });
  }

  private async assertCanHold(cart: Cart, variantId: string, quantity: number): Promise<void> {
    const variant = (await this.catalog.lookup([variantId])).get(variantId);
    if (!variant) throw new NotFoundError('Variante', variantId);
    if (!variant.purchasable) {
      throw new BusinessRuleViolation('Este producto no está disponible', 'VARIANT_NOT_AVAILABLE');
    }
    const stock = (await this.stock.availableFor([variantId], cart.id)).get(variantId);
    const available = stock?.available ?? 0;
    if (quantity > available) {
      throw new BusinessRuleViolation(
        available > 0 ? `Solo hay ${available} unidades disponibles` : 'Producto agotado',
        'INSUFFICIENT_STOCK',
        { lines: [{ variantId, requested: quantity, available }] },
      );
    }
  }

  private guestExpiry(): Date {
    return new Date(this.clock.now().getTime() + this.settings.guestCartTtlDays * 86_400_000);
  }

  /**
   * Encuentra (o crea) el carrito. Si un invitado inicia sesión, su carrito se
   * incorpora al del usuario y la cookie se borra.
   */
  private async resolve(
    identity: CartIdentity,
    create: boolean,
  ): Promise<{ cart: Cart | null; cookie: GuestCookie }> {
    const guest = identity.guestKey
      ? await this.carts.findByGuestKeyHash(this.keys.hash(identity.guestKey))
      : null;

    if (identity.userId) {
      let cart = await this.carts.findByUserId(identity.userId);
      if (guest) {
        cart ??= Cart.forUser(identity.userId);
        await this.stock.releaseForCart(guest.id, 'cart_deleted');
        await this.stock.releaseForCart(cart.id, 'cart_changed');
        await this.carts.delete(guest.id);
        cart.absorb(guest);
        await this.carts.save(cart);
      } else if (!cart && create) {
        cart = Cart.forUser(identity.userId);
      }
      return { cart, cookie: identity.guestKey ? 'clear' : null };
    }

    if (guest) {
      // Se reenvía la cookie para renovar su vencimiento.
      return { cart: guest, cookie: { set: identity.guestKey! } };
    }
    if (!create) return { cart: null, cookie: identity.guestKey ? 'clear' : null };
    const { key, hash } = this.keys.generate();
    return { cart: Cart.forGuest(hash, this.guestExpiry()), cookie: { set: key } };
  }
}
