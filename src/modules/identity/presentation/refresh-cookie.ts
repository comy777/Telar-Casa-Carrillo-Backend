import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE_NAME = 'tcc_refresh';

/** Las cookies Secure solo viajan por HTTPS; en desarrollo local se desactivan. */
export const SECURE_COOKIES = Symbol('SecureCookies');
/** La cookie solo viaja a las rutas de sesión, no a toda la API. */
const COOKIE_PATH = '/api/v1/auth';

/**
 * El refresh token vive en una cookie HttpOnly (JavaScript no puede leerla) y
 * SameSite=Strict (no se envía desde otros sitios, lo que evita CSRF en /refresh).
 * El access token, de vida corta, lo guarda el frontend en memoria.
 */
function options(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: COOKIE_PATH };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  response.cookie(REFRESH_COOKIE_NAME, token, { ...options(secure), expires: expiresAt });
}

export function clearRefreshCookie(response: Response, secure: boolean): void {
  response.clearCookie(REFRESH_COOKIE_NAME, options(secure));
}

export function readRefreshCookie(request: Request): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
