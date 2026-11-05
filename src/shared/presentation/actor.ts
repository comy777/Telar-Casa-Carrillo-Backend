import type { Request } from 'express';
import type { AuthenticatedUser } from '../application/authenticated-user';
import type { RequestContext } from '../application/audit-trail';
import { requestContextOf } from './request-context';

/** Quién hace una acción administrativa y desde dónde (para auditoría). */
export interface Actor {
  id: string;
  context: RequestContext;
}

export const actorOf = (user: AuthenticatedUser, request: Request): Actor => ({
  id: user.id,
  context: requestContextOf(request),
});
