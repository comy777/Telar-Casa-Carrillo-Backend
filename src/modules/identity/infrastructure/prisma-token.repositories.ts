import { Injectable } from '@nestjs/common';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type {
  RefreshTokenRecord,
  RefreshTokenRepository,
  RoleRepository,
  RoleView,
  UserTokenPurpose,
  UserTokenRepository,
} from '../application/ports';

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async create(token: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.client.refreshToken.create({ data: token });
  }

  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.db.client.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
        replacedByTokenId: true,
      },
    });
  }

  async markRotated(id: string, replacedByTokenId: string, now: Date): Promise<boolean> {
    // Condicional: solo una de dos peticiones simultáneas con el mismo token gana.
    const { count } = await this.db.client.refreshToken.updateMany({
      where: { id, revokedAt: null, replacedByTokenId: null },
      data: { revokedAt: now, replacedByTokenId },
    });
    return count === 1;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.db.client.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.db.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}

@Injectable()
export class PrismaUserTokenRepository implements UserTokenRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async create(token: {
    userId: string;
    purpose: UserTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.client.userToken.create({ data: token });
  }

  findValid(
    tokenHash: string,
    purpose: UserTokenPurpose,
    now: Date,
  ): Promise<{ id: string; userId: string } | null> {
    return this.db.client.userToken.findFirst({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true },
    });
  }

  async markUsed(id: string, now: Date): Promise<boolean> {
    const { count } = await this.db.client.userToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: now },
    });
    return count === 1;
  }

  async invalidateAll(userId: string, purpose: UserTokenPurpose, now: Date): Promise<void> {
    await this.db.client.userToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now },
    });
  }
}

@Injectable()
export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async list(): Promise<RoleView[]> {
    const rows = await this.db.client.role.findMany({
      orderBy: { name: 'asc' },
      select: {
        name: true,
        description: true,
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });
    return rows.map((row) => ({
      name: row.name,
      description: row.description,
      permissions: row.permissions.map((rp) => rp.permission.key).sort(),
      userCount: row._count.users,
    }));
  }

  async findExistingNames(names: string[]): Promise<string[]> {
    const rows = await this.db.client.role.findMany({
      where: { name: { in: names } },
      select: { name: true },
    });
    return rows.map((row) => row.name);
  }
}
