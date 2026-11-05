import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Page,
  type RequestContext,
} from '../../../shared/application/audit-trail';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import { ROLES } from '../domain/permissions';
import type { User } from '../domain/user';
import {
  ROLE_REPOSITORY,
  type RoleRepository,
  type RoleView,
  USER_REPOSITORY,
  type UserListQuery,
  type UserRepository,
} from './ports';
import { SessionService } from './session.service';

@Injectable()
export class ListUsers {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  execute(query: UserListQuery): Promise<Page<User>> {
    return this.users.list(query);
  }
}

@Injectable()
export class GetUser {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('Usuario', id);
    return user;
  }
}

export type UserStatusAction = 'suspend' | 'reactivate';

@Injectable()
export class ChangeUserStatus {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    private readonly sessions: SessionService,
  ) {}

  execute(
    actorId: string,
    userId: string,
    action: UserStatusAction,
    context: RequestContext,
  ): Promise<User> {
    if (actorId === userId) {
      throw new BusinessRuleViolation(
        'No puedes cambiar el estado de tu propia cuenta',
        'CANNOT_CHANGE_OWN_STATUS',
      );
    }
    return this.unitOfWork.execute(async () => {
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('Usuario', userId);
      const previous = user.status;

      if (action === 'suspend') {
        user.suspend();
        await this.sessions.endAllForUser(user.id);
      } else {
        user.reactivate();
      }
      await this.users.save(user);
      await this.audit.record({
        actorId,
        action: action === 'suspend' ? 'user.suspended' : 'user.reactivated',
        resource: 'User',
        resourceId: user.id,
        metadata: { from: previous, to: user.status },
        ipAddress: context.ipAddress,
      });
      return user;
    });
  }
}

@Injectable()
export class AssignUserRoles {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  execute(
    actorId: string,
    userId: string,
    roles: string[],
    context: RequestContext,
  ): Promise<User> {
    const requested = [...new Set(roles)];
    if (actorId === userId && !requested.includes(ROLES.ADMIN)) {
      // Evita que el último administrador se quede sin acceso por error.
      throw new BusinessRuleViolation(
        'No puedes quitarte el rol de administrador',
        'CANNOT_REMOVE_OWN_ADMIN',
      );
    }
    return this.unitOfWork.execute(async () => {
      const existing = await this.roles.findExistingNames(requested);
      const unknown = requested.filter((role) => !existing.includes(role));
      if (unknown.length > 0) {
        throw new BusinessRuleViolation('Hay roles que no existen', 'UNKNOWN_ROLES', { unknown });
      }
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('Usuario', userId);

      const previous = [...user.roles];
      user.assignRoles(requested);
      await this.users.save(user);
      await this.audit.record({
        actorId,
        action: 'user.roles_changed',
        resource: 'User',
        resourceId: user.id,
        metadata: { from: previous, to: [...user.roles] },
        ipAddress: context.ipAddress,
      });
      return user;
    });
  }
}

@Injectable()
export class ListRoles {
  constructor(@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository) {}

  execute(): Promise<RoleView[]> {
    return this.roles.list();
  }
}
