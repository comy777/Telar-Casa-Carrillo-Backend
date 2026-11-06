import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_TRAIL,
  type AuditTrail,
  type RequestContext,
} from '../../../shared/application/audit-trail';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { AuthenticationError, NotFoundError } from '../../../shared/domain/errors';
import { assertPasswordAllowed } from '../domain/password-policy';
import type { User } from '../domain/user';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  USER_REPOSITORY,
  type UserRepository,
} from './ports';
import { type IssuedSession, SessionService } from './session.service';

export interface ProfileView {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

const toView = (user: User): ProfileView => ({
  email: user.email.value,
  firstName: user.firstName,
  lastName: user.lastName,
  phone: user.phone,
});

/** Datos personales del cliente con sesión. */
@Injectable()
export class AccountProfile {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  async get(userId: string): Promise<ProfileView> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Usuario', userId);
    return toView(user);
  }

  update(
    userId: string,
    changes: { firstName?: string; lastName?: string; phone?: string | null },
    context: RequestContext,
  ): Promise<ProfileView> {
    return this.unitOfWork.execute(async () => {
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('Usuario', userId);
      user.updateProfile(changes);
      await this.users.save(user);
      await this.audit.record({
        actorId: userId,
        action: 'user.profile_updated',
        resource: 'User',
        resourceId: userId,
        metadata: { fields: Object.keys(changes) },
        ipAddress: context.ipAddress,
      });
      return toView(user);
    });
  }
}

/**
 * Cambio de contraseña con sesión: exige la actual, cierra todas las sesiones
 * (también en otros dispositivos) y abre una nueva para este navegador.
 */
@Injectable()
export class ChangePassword {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    private readonly sessions: SessionService,
  ) {}

  async execute(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    context: RequestContext,
  ): Promise<IssuedSession> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Usuario', userId);
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) {
      throw new AuthenticationError(
        'La contraseña actual no es correcta',
        'INVALID_CURRENT_PASSWORD',
      );
    }
    assertPasswordAllowed(input.newPassword);
    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.unitOfWork.execute(async () => {
      user.changePasswordHash(passwordHash);
      await this.users.save(user);
      await this.sessions.endAllForUser(user.id);
      await this.audit.record({
        actorId: user.id,
        action: 'auth.password_changed',
        resource: 'User',
        resourceId: user.id,
        ipAddress: context.ipAddress,
      });
    });
    return this.sessions.start(user.id);
  }
}
