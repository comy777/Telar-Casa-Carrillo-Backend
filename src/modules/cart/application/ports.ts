import type { Cart } from '../domain/cart';

export interface CartRepository {
  findById(id: string): Promise<Cart | null>;
  findByUserId(userId: string): Promise<Cart | null>;
  findByGuestKeyHash(hash: string): Promise<Cart | null>;
  /** Crea o actualiza, reemplazando las líneas. */
  save(cart: Cart): Promise<void>;
  delete(id: string): Promise<void>;
  findExpiredGuestCartIds(now: Date, limit: number): Promise<string[]>;
}
export const CART_REPOSITORY = Symbol('CartRepository');

/** Datos de catálogo que el carrito necesita, siempre leídos al momento. */
export interface PurchasableVariant {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  variantName: string;
  sku: string;
  attributes: Record<string, string>;
  priceCents: number;
  currency: string;
  /** Tarifa de IVA incluida en el precio, en diezmilésimas. */
  taxRateBasisPoints: number;
  image: { url: string; altText: string | null } | null;
  /** Producto publicado y variante activa. */
  purchasable: boolean;
}

export interface CartCatalog {
  lookup(variantIds: string[]): Promise<Map<string, PurchasableVariant>>;
}
export const CART_CATALOG = Symbol('CartCatalog');

/** Claves de carrito de invitado: aleatorias; en la base solo se guarda su hash. */
export interface GuestCartKeys {
  generate(): { key: string; hash: string };
  hash(key: string): string;
}
export const GUEST_CART_KEYS = Symbol('GuestCartKeys');

export interface CartSettings {
  guestCartTtlDays: number;
}
export const CART_SETTINGS = Symbol('CartSettings');
