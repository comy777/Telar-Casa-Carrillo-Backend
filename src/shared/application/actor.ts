import type { RequestContext } from './audit-trail';

/** Quién hace una acción administrativa y desde dónde (para auditoría). */
export interface Actor {
  id: string;
  context: RequestContext;
}
