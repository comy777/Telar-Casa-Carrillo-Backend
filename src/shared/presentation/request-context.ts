import type { Request } from 'express';
import type { RequestContext } from '../application/audit-trail';

export const requestContextOf = (request: Request): RequestContext => ({
  ipAddress: request.ip ?? null,
});
