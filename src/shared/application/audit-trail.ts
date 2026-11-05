export interface AuditEntry {
  /** null cuando la acción la hace el sistema o alguien no autenticado. */
  actorId: string | null;
  /** Verbo en formato "recurso.acción", p. ej. "user.suspended". */
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/** Registro de auditoría de acciones relevantes (solo se agregan filas). */
export interface AuditTrail {
  record(entry: AuditEntry): Promise<void>;
}

export const AUDIT_TRAIL = Symbol('AuditTrail');

/** Datos de la petición que los casos de uso necesitan para auditar. */
export interface RequestContext {
  ipAddress: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageRequest {
  page: number;
  pageSize: number;
}
