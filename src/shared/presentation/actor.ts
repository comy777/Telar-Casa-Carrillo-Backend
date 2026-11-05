import type { Request } from 'express';
import type { Actor } from '../application/actor';
import type { AuthenticatedUser } from '../application/authenticated-user';
import { requestContextOf } from './request-context';

export type { Actor };

export const actorOf = (user: AuthenticatedUser, request: Request): Actor => ({
  id: user.id,
  context: requestContextOf(request),
});
