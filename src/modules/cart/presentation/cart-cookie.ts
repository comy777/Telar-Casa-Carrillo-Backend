import type { CookieOptions, Request, Response } from 'express';
import type { GuestCookie } from '../application/cart.service';

export const CART_COOKIE = 'tcc_cart';
export const SECURE_CART_COOKIE = Symbol('SecureCartCookie');
export const GUEST_CART_TTL_DAYS = Symbol('GuestCartTtlDays');

/**
 * Lax (no Strict): el carrito debe seguir ahí cuando el cliente llega a la
 * tienda desde un enlace externo. Los cambios igual exigen peticiones del mismo
 * sitio: los navegadores no envían cookies Lax en POST de otros sitios.
 * La ruta cubre /cart y, en la Fase 5, /checkout.
 */
const baseOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'lax',
  path: '/api/v1',
});

const KEY_PATTERN = /^[\w-]{20,100}$/;

export function guestKeyOf(request: Request): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[CART_COOKIE];
  return typeof value === 'string' && KEY_PATTERN.test(value) ? value : null;
}

export function applyGuestCookie(
  response: Response,
  cookie: GuestCookie,
  secure: boolean,
  ttlDays: number,
): void {
  if (cookie === 'clear') {
    response.clearCookie(CART_COOKIE, baseOptions(secure));
  } else if (cookie) {
    response.cookie(CART_COOKIE, cookie.set, {
      ...baseOptions(secure),
      maxAge: ttlDays * 86_400_000,
    });
  }
}
