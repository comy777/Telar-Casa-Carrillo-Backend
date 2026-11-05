import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../application/authenticated-user';

export type { AuthenticatedUser };

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'auth:requiredPermissions';

/** El guard de autenticación deja el usuario en la petición. */
export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/** Por defecto toda ruta exige access token; esta la deja abierta. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Exige todos los permisos indicados (además de estar autenticado). */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) {
      throw new Error('@CurrentUser() se usó en una ruta pública');
    }
    return user;
  },
);

export const OPTIONAL_AUTH_KEY = 'auth:optional';

/**
 * La ruta funciona con o sin sesión (p. ej. el carrito de invitado). Si llega un
 * access token se valida igual que en las demás rutas; uno inválido da 401
 * para que el cliente lo renueve en vez de perder el carrito del usuario.
 */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);

/** Usuario autenticado o null (para rutas con @OptionalAuth()). */
export const MaybeCurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | null =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user ?? null,
);
