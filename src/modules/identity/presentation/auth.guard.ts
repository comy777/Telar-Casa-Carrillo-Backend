import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticationError, ForbiddenError } from '../../../shared/domain/errors';
import {
  type AuthenticatedRequest,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../../shared/presentation/auth.decorators';
import {
  ACCESS_TOKENS,
  type AccessTokens,
  USER_REPOSITORY,
  type UserRepository,
} from '../application/ports';

/**
 * Guard global: toda ruta exige un access token válido salvo las marcadas con
 * @Public(). Después comprueba los permisos de @RequirePermissions().
 *
 * El usuario y sus permisos se leen de la base en cada petición, así que
 * suspender una cuenta o quitarle un rol surte efecto de inmediato.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKENS) private readonly accessTokens: AccessTokens,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationError('Falta el token de acceso', 'MISSING_ACCESS_TOKEN');
    }

    const userId = await this.accessTokens.verify(token);
    if (!userId) {
      throw new AuthenticationError(
        'El token de acceso no es válido o venció',
        'INVALID_ACCESS_TOKEN',
      );
    }
    const user = await this.users.findAccess(userId);
    if (user?.status !== 'ACTIVE') {
      throw new AuthenticationError('La cuenta no está activa', 'ACCOUNT_INACTIVE');
    }
    request.user = user;

    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS_KEY, targets) ??
      [];
    const missing = required.filter((permission) => !user.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenError('No tienes permiso para esta acción', 'MISSING_PERMISSION', {
        missing,
      });
    }
    return true;
  }
}
