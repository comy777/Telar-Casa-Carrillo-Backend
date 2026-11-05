import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditEntry, AuditTrail, Page } from '../../../shared/application/audit-trail';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type { AuditLogQuery, AuditLogReader, AuditLogView } from '../application/audit-log-reader';

@Injectable()
export class PrismaAuditTrail implements AuditTrail {
  constructor(private readonly db: PrismaClientProvider) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.client.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }
}

@Injectable()
export class PrismaAuditLogReader implements AuditLogReader {
  constructor(private readonly db: PrismaClientProvider) {}

  async list(query: AuditLogQuery): Promise<Page<AuditLogView>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.resource ? { resource: query.resource } : {}),
      ...(query.action ? { action: query.action } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.auditLog.findMany({
        where,
        include: { actor: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.client.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorEmail: row.actor?.email ?? null,
        action: row.action,
        resource: row.resource,
        resourceId: row.resourceId,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
