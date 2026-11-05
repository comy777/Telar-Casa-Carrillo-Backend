import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Page } from '../../../shared/application/audit-trail';
import { ConflictError } from '../../../shared/domain/errors';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type { UserAccess, UserListQuery, UserRepository } from '../application/ports';
import { Email } from '../domain/email';
import { User } from '../domain/user';

const withRoles = { roles: { include: { role: { select: { name: true } } } } } as const;
type UserRow = Prisma.UserGetPayload<{ include: typeof withRoles }>;

function toDomain(row: UserRow): User {
  return User.restore({
    id: row.id,
    email: Email.create(row.email),
    passwordHash: row.passwordHash,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    status: row.status,
    emailVerifiedAt: row.emailVerifiedAt,
    termsAcceptedAt: row.termsAcceptedAt,
    privacyPolicyAcceptedAt: row.privacyPolicyAcceptedAt,
    privacyPolicyVersion: row.privacyPolicyVersion,
    roles: row.roles.map((userRole) => userRole.role.name).sort(),
    createdAt: row.createdAt,
  });
}

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db.client.user.findUnique({ where: { id }, include: withRoles });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const row = await this.db.client.user.findUnique({
      where: { email: email.value },
      include: withRoles,
    });
    return row ? toDomain(row) : null;
  }

  async findAccess(id: string): Promise<UserAccess | null> {
    const row = await this.db.client.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        roles: {
          select: {
            role: {
              select: {
                name: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    const roles = row.roles.map(({ role }) => role.name).sort();
    const permissions = [
      ...new Set(row.roles.flatMap(({ role }) => role.permissions.map((rp) => rp.permission.key))),
    ].sort();
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      status: row.status,
      roles,
      permissions,
    };
  }

  async save(user: User): Promise<void> {
    const s = user.toSnapshot();
    const roleRows = await this.db.client.role.findMany({
      where: { name: { in: s.roles } },
      select: { id: true, name: true },
    });
    if (roleRows.length !== s.roles.length) {
      const found = roleRows.map((role) => role.name);
      const missing = s.roles.filter((role) => !found.includes(role));
      // Error de configuración, no del usuario: faltan los roles base.
      throw new Error(`Roles inexistentes: ${missing.join(', ')}. Ejecuta "npm run db:seed".`);
    }

    const fields = {
      email: s.email.value,
      passwordHash: s.passwordHash,
      firstName: s.firstName,
      lastName: s.lastName,
      phone: s.phone,
      status: s.status,
      emailVerifiedAt: s.emailVerifiedAt,
      termsAcceptedAt: s.termsAcceptedAt,
      privacyPolicyAcceptedAt: s.privacyPolicyAcceptedAt,
      privacyPolicyVersion: s.privacyPolicyVersion,
    };
    const roleLinks = roleRows.map((role) => ({ roleId: role.id }));

    try {
      await this.db.client.user.upsert({
        where: { id: s.id },
        create: { id: s.id, createdAt: s.createdAt, ...fields, roles: { create: roleLinks } },
        update: { ...fields, roles: { deleteMany: {}, create: roleLinks } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Ya existe una cuenta con este correo', 'EMAIL_TAKEN');
      }
      throw error;
    }
  }

  async list(query: UserListQuery): Promise<Page<User>> {
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.user.findMany({
        where,
        include: withRoles,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.client.user.count({ where }),
    ]);
    return { items: rows.map(toDomain), total, page: query.page, pageSize: query.pageSize };
  }
}
