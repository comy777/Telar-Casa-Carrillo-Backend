import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_TRAIL,
  type AuditTrail,
  type RequestContext,
} from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { Email } from '../domain/email';
import { assertPasswordAllowed } from '../domain/password-policy';
import { AccountEmailsService } from './account-emails.service';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  SECURE_TOKENS,
  type SecureTokens,
  USER_REPOSITORY,
  USER_TOKEN_REPOSITORY,
  type UserRepository,
  type UserTokenRepository,
} from './ports';
import { INVALID_TOKEN_ERROR } from './registration.use-cases';
import { SessionService } from './session.service';

/** Siempre termina sin error: no revela si el correo está registrado. */
@Injectable()
export class RequestPasswordReset {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly emails: AccountEmailsService,
  ) {}

  async execute(rawEmail: string): Promise<void> {
    let email: Email;
    try {
      email = Email.create(rawEmail);
    } catch {
      return;
    }
    const user = await this.users.findByEmail(email);
    if (user && user.status !== 'SUSPENDED') {
      await this.emails.sendPasswordReset(user);
    }
  }
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

@Injectable()
export class ResetPassword {
  constructor(
    @Inject(USER_TOKEN_REPOSITORY) private readonly userTokens: UserTokenRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SECURE_TOKENS) private readonly tokens: SecureTokens,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sessions: SessionService,
  ) {}

  async execute(input: ResetPasswordInput, context: RequestContext): Promise<void> {
    assertPasswordAllowed(input.password);
    const passwordHash = await this.hasher.hash(input.password);

    await this.unitOfWork.execute(async () => {
      const now = this.clock.now();
      const token = await this.userTokens.findValid(
        this.tokens.hash(input.token),
        'PASSWORD_RESET',
        now,
      );
      if (!token || !(await this.userTokens.markUsed(token.id, now))) {
        throw INVALID_TOKEN_ERROR();
      }
      const user = await this.users.findById(token.userId);
      if (!user || user.status === 'SUSPENDED') throw INVALID_TOKEN_ERROR();

      user.changePasswordHash(passwordHash);
      // Abrir el enlace prueba que controla el correo.
      if (user.status === 'PENDING_VERIFICATION') user.verifyEmail(now);
      await this.users.save(user);
      // Con contraseña nueva se cierran todas las sesiones abiertas.
      await this.sessions.endAllForUser(user.id);
      await this.audit.record({
        actorId: user.id,
        action: 'auth.password_reset',
        resource: 'User',
        resourceId: user.id,
        ipAddress: context.ipAddress,
      });
    });
  }
}
