import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_TRAIL,
  type AuditTrail,
  type RequestContext,
} from '../../../shared/application/audit-trail';
import { AuthenticationError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors';
import { Email } from '../domain/email';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  USER_REPOSITORY,
  type UserAccess,
  type UserRepository,
} from './ports';
import { type IssuedSession, SessionService } from './session.service';

export interface LoginInput {
  email: string;
  password: string;
}

@Injectable()
export class Login {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    private readonly sessions: SessionService,
  ) {}

  async execute(
    input: LoginInput,
    context: RequestContext,
  ): Promise<{ session: IssuedSession; user: UserAccess }> {
    let email: Email | null = null;
    try {
      email = Email.create(input.email);
    } catch {
      // Correo mal formado: se responde igual que con credenciales incorrectas.
    }
    const user = email ? await this.users.findByEmail(email) : null;
    // Se verifica siempre, exista o no el usuario, para no revelar cuáles existen por el tiempo de respuesta.
    const passwordMatches = await this.hasher.verify(user?.passwordHash ?? null, input.password);

    if (!user || !passwordMatches) {
      await this.audit.record({
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        resource: 'User',
        resourceId: user?.id ?? null,
        metadata: { email: email?.value ?? null },
        ipAddress: context.ipAddress,
      });
      throw new AuthenticationError('Correo o contraseña incorrectos', 'INVALID_CREDENTIALS');
    }
    // Solo se informa el estado a quien demostró conocer la contraseña.
    if (user.status === 'PENDING_VERIFICATION') {
      throw new ForbiddenError(
        'Debes confirmar tu correo antes de iniciar sesión',
        'EMAIL_NOT_VERIFIED',
      );
    }
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenError('La cuenta está suspendida', 'ACCOUNT_SUSPENDED');
    }

    const session = await this.sessions.start(user.id);
    await this.audit.record({
      actorId: user.id,
      action: 'auth.login',
      resource: 'User',
      resourceId: user.id,
      ipAddress: context.ipAddress,
    });
    const access = await this.users.findAccess(user.id);
    if (!access) throw new NotFoundError('Usuario', user.id);
    return { session, user: access };
  }
}

@Injectable()
export class GetCurrentUser {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string): Promise<UserAccess> {
    const access = await this.users.findAccess(userId);
    if (!access) throw new NotFoundError('Usuario', userId);
    return access;
  }
}
