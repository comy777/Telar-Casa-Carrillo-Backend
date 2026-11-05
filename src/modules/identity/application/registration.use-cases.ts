import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_TRAIL,
  type AuditTrail,
  type RequestContext,
} from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, ConflictError } from '../../../shared/domain/errors';
import { Email } from '../domain/email';
import { assertPasswordAllowed } from '../domain/password-policy';
import { ROLES } from '../domain/permissions';
import { User } from '../domain/user';
import { AccountEmailsService } from './account-emails.service';
import { IDENTITY_SETTINGS, type IdentitySettings } from './identity-settings';
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

export interface RegisterUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string | undefined;
  acceptTerms: boolean;
}

export const INVALID_TOKEN_ERROR = () =>
  new BusinessRuleViolation('El enlace no es válido o ya venció', 'INVALID_OR_EXPIRED_TOKEN');

@Injectable()
export class RegisterUser {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_SETTINGS) private readonly settings: IdentitySettings,
    private readonly emails: AccountEmailsService,
  ) {}

  async execute(input: RegisterUserInput, context: RequestContext): Promise<{ userId: string }> {
    if (!input.acceptTerms) {
      throw new BusinessRuleViolation(
        'Debes aceptar los términos y la política de tratamiento de datos',
        'TERMS_NOT_ACCEPTED',
      );
    }
    const email = Email.create(input.email);
    assertPasswordAllowed(input.password);
    // El hash es lento a propósito: se calcula fuera de la transacción.
    const passwordHash = await this.hasher.hash(input.password);

    const user = await this.unitOfWork.execute(async () => {
      if (await this.users.findByEmail(email)) {
        throw new ConflictError('Ya existe una cuenta con este correo', 'EMAIL_TAKEN');
      }
      const user = User.register({
        email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
        privacyPolicyVersion: this.settings.privacyPolicyVersion,
        roles: [ROLES.CUSTOMER],
        now: this.clock.now(),
      });
      await this.users.save(user);
      await this.audit.record({
        actorId: user.id,
        action: 'auth.registered',
        resource: 'User',
        resourceId: user.id,
        metadata: { privacyPolicyVersion: this.settings.privacyPolicyVersion },
        ipAddress: context.ipAddress,
      });
      return user;
    });

    // Después de confirmar la cuenta: si el correo falla, se puede reenviar.
    await this.emails.sendEmailVerification(user);
    return { userId: user.id };
  }
}

@Injectable()
export class VerifyEmail {
  constructor(
    @Inject(USER_TOKEN_REPOSITORY) private readonly userTokens: UserTokenRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SECURE_TOKENS) private readonly tokens: SecureTokens,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(rawToken: string, context: RequestContext): Promise<void> {
    await this.unitOfWork.execute(async () => {
      const now = this.clock.now();
      const token = await this.userTokens.findValid(
        this.tokens.hash(rawToken),
        'EMAIL_VERIFICATION',
        now,
      );
      if (!token || !(await this.userTokens.markUsed(token.id, now))) {
        throw INVALID_TOKEN_ERROR();
      }
      const user = await this.users.findById(token.userId);
      if (!user) throw INVALID_TOKEN_ERROR();

      user.verifyEmail(now);
      await this.users.save(user);
      await this.audit.record({
        actorId: user.id,
        action: 'auth.email_verified',
        resource: 'User',
        resourceId: user.id,
        ipAddress: context.ipAddress,
      });
    });
  }
}

/** Siempre termina sin error: no revela si el correo está registrado. */
@Injectable()
export class ResendEmailVerification {
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
    if (user?.status === 'PENDING_VERIFICATION') {
      await this.emails.sendEmailVerification(user);
    }
  }
}
