import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_TRAIL,
  type AuditTrail,
  type RequestContext,
} from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { AuthenticationError } from '../../../shared/domain/errors';
import { IDENTITY_SETTINGS, type IdentitySettings } from './identity-settings';
import {
  ACCESS_TOKENS,
  type AccessTokens,
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
  SECURE_TOKENS,
  type SecureTokens,
  USER_REPOSITORY,
  type UserRepository,
} from './ports';

export interface IssuedSession {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

type RotationOutcome =
  | { kind: 'rotated'; session: IssuedSession }
  | { kind: 'unknown' | 'expired' | 'revoked' | 'inactive' }
  | { kind: 'reused'; userId: string; familyId: string };

/**
 * Sesiones con refresh tokens rotativos. Cada inicio de sesión crea una
 * "familia"; cada refresh entrega un token nuevo y retira el anterior. Si un
 * token ya rotado vuelve a aparecer, alguien lo copió: se revoca la familia entera.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SECURE_TOKENS) private readonly tokens: SecureTokens,
    @Inject(ACCESS_TOKENS) private readonly accessTokens: AccessTokens,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_SETTINGS) private readonly settings: IdentitySettings,
  ) {}

  start(userId: string): Promise<IssuedSession> {
    return this.issue(userId, crypto.randomUUID()).then(({ session }) => session);
  }

  async rotate(rawRefreshToken: string, context: RequestContext): Promise<IssuedSession> {
    const tokenHash = this.tokens.hash(rawRefreshToken);

    // La transacción solo devuelve el resultado: si se lanzara el error adentro,
    // también se desharía la revocación de la familia.
    const outcome = await this.unitOfWork.execute<RotationOutcome>(async () => {
      const now = this.clock.now();
      const record = await this.refreshTokens.findByHash(tokenHash);
      if (!record) return { kind: 'unknown' };

      if (record.replacedByTokenId) {
        await this.refreshTokens.revokeFamily(record.familyId, now);
        return { kind: 'reused', userId: record.userId, familyId: record.familyId };
      }
      if (record.revokedAt) return { kind: 'revoked' };
      if (record.expiresAt <= now) return { kind: 'expired' };

      const user = await this.users.findById(record.userId);
      if (!user?.isActive) {
        await this.refreshTokens.revokeFamily(record.familyId, now);
        return { kind: 'inactive' };
      }

      const next = await this.issue(record.userId, record.familyId);
      const rotated = await this.refreshTokens.markRotated(record.id, next.tokenId, now);
      if (!rotated) {
        // Dos refresh simultáneos con el mismo token: se trata como reutilización.
        await this.refreshTokens.revokeFamily(record.familyId, now);
        return { kind: 'reused', userId: record.userId, familyId: record.familyId };
      }
      return { kind: 'rotated', session: next.session };
    });

    switch (outcome.kind) {
      case 'rotated':
        return outcome.session;
      case 'reused':
        await this.audit.record({
          actorId: outcome.userId,
          action: 'auth.refresh_token_reused',
          resource: 'User',
          resourceId: outcome.userId,
          metadata: { familyId: outcome.familyId },
          ipAddress: context.ipAddress,
        });
        throw new AuthenticationError(
          'La sesión se cerró por seguridad. Vuelve a iniciar sesión.',
          'REFRESH_TOKEN_REUSED',
        );
      case 'expired':
        throw new AuthenticationError('La sesión venció', 'SESSION_EXPIRED');
      default:
        throw new AuthenticationError('La sesión no es válida', 'INVALID_SESSION');
    }
  }

  /** Cierra la sesión (la familia del token). No falla si el token no existe. */
  async end(rawRefreshToken: string): Promise<void> {
    const record = await this.refreshTokens.findByHash(this.tokens.hash(rawRefreshToken));
    if (record) {
      await this.refreshTokens.revokeFamily(record.familyId, this.clock.now());
    }
  }

  async endAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId, this.clock.now());
  }

  private async issue(
    userId: string,
    familyId: string,
  ): Promise<{ tokenId: string; session: IssuedSession }> {
    const now = this.clock.now();
    const tokenId = crypto.randomUUID();
    const { token, hash } = this.tokens.generate();
    const refreshTokenExpiresAt = new Date(
      now.getTime() + this.settings.refreshTokenTtlDays * 86_400_000,
    );
    await this.refreshTokens.create({
      id: tokenId,
      userId,
      familyId,
      tokenHash: hash,
      expiresAt: refreshTokenExpiresAt,
    });
    return {
      tokenId,
      session: {
        accessToken: await this.accessTokens.issue(userId),
        accessTokenExpiresIn: this.settings.accessTokenTtlSeconds,
        refreshToken: token,
        refreshTokenExpiresAt,
      },
    };
  }
}
