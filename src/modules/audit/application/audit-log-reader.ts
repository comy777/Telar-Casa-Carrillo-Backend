import type { Page, PageRequest } from '../../../shared/application/audit-trail';

export interface AuditLogView {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: Date;
}

export interface AuditLogQuery extends PageRequest {
  actorId?: string | undefined;
  resource?: string | undefined;
  action?: string | undefined;
}

export interface AuditLogReader {
  list(query: AuditLogQuery): Promise<Page<AuditLogView>>;
}

export const AUDIT_LOG_READER = Symbol('AuditLogReader');
