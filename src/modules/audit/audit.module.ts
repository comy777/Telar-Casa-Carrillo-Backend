import { Global, Module } from '@nestjs/common';
import { AUDIT_TRAIL } from '../../shared/application/audit-trail';
import { AUDIT_LOG_READER } from './application/audit-log-reader';
import { PrismaAuditLogReader, PrismaAuditTrail } from './infrastructure/prisma-audit';
import { AdminAuditController } from './presentation/admin-audit.controller';

/** Global: cualquier módulo puede registrar auditoría inyectando AUDIT_TRAIL. */
@Global()
@Module({
  controllers: [AdminAuditController],
  providers: [
    { provide: AUDIT_TRAIL, useClass: PrismaAuditTrail },
    { provide: AUDIT_LOG_READER, useClass: PrismaAuditLogReader },
  ],
  exports: [AUDIT_TRAIL],
})
export class AuditModule {}
