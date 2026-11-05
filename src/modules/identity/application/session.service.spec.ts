import type { AuditEntry, AuditTrail } from '../../../shared/application/audit-trail';
import type { Clock } from '../../../shared/application/clock';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { AuthenticationError } from '../../../shared/domain/errors';
import { Email } from '../domain/email';
import { User } from '../domain/user';
import type { IdentitySettings } from './identity-settings';
import type {
  AccessTokens,
  RefreshTokenRecord,
  RefreshTokenRepository,
  SecureTokens,
  UserRepository,
} from './ports';
import { SessionService } from './session.service';

class InMemoryRefreshTokens implements RefreshTokenRepository {
  rows: (RefreshTokenRecord & { tokenHash: string })[] = [];

  create(t: { id: string; userId: string; familyId: string; tokenHash: string; expiresAt: Date }) {
    this.rows.push({ ...t, revokedAt: null, replacedByTokenId: null });
    return Promise.resolve();
  }
  findByHash(hash: string) {
    return Promise.resolve(this.rows.find((r) => r.tokenHash === hash) ?? null);
  }
  markRotated(id: string, replacedBy: string, now: Date) {
    const row = this.rows.find((r) => r.id === id && !r.revokedAt && !r.replacedByTokenId);
    if (!row) return Promise.resolve(false);
    row.revokedAt = now;
    row.replacedByTokenId = replacedBy;
    return Promise.resolve(true);
  }
  revokeFamily(familyId: string, now: Date) {
    this.rows
      .filter((r) => r.familyId === familyId && !r.revokedAt)
      .forEach((r) => (r.revokedAt = now));
    return Promise.resolve();
  }
  revokeAllForUser(userId: string, now: Date) {
    this.rows
      .filter((r) => r.userId === userId && !r.revokedAt)
      .forEach((r) => (r.revokedAt = now));
    return Promise.resolve();
  }
}

describe('SessionService', () => {
  let now: Date;
  let refreshTokens: InMemoryRefreshTokens;
  let audit: AuditEntry[];
  let user: User;
  let service: SessionService;

  beforeEach(() => {
    now = new Date('2026-11-05T12:00:00Z');
    refreshTokens = new InMemoryRefreshTokens();
    audit = [];
    user = User.register({
      email: Email.create('ana@example.com'),
      passwordHash: 'h',
      firstName: 'Ana',
      lastName: 'Pérez',
      privacyPolicyVersion: 'v',
      roles: ['customer'],
      now,
    });
    user.verifyEmail(now);

    let counter = 0;
    const tokens: SecureTokens = {
      generate: () => {
        counter += 1;
        return { token: `token-${counter}`, hash: `hash:token-${counter}` };
      },
      hash: (token) => `hash:${token}`,
    };
    const accessTokens: AccessTokens = {
      issue: (id) => Promise.resolve(`access-for-${id}`),
      verify: () => Promise.resolve(null),
    };
    const users = { findById: () => Promise.resolve(user) } as unknown as UserRepository;
    const unitOfWork: UnitOfWork = {
      execute: (work) => work(),
      afterCommit: (callback) => void callback(),
    };
    const auditTrail: AuditTrail = {
      record: (entry) => {
        audit.push(entry);
        return Promise.resolve();
      },
    };
    const clock: Clock = { now: () => now };
    const settings = { refreshTokenTtlDays: 30, accessTokenTtlSeconds: 900 } as IdentitySettings;

    service = new SessionService(
      refreshTokens,
      users,
      tokens,
      accessTokens,
      unitOfWork,
      auditTrail,
      clock,
      settings,
    );
  });

  const ctx = { ipAddress: '127.0.0.1' };
  const rejectCode = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    return (error as AuthenticationError).code;
  };

  it('al iniciar sesión crea un refresh token y un access token', async () => {
    const session = await service.start(user.id);
    expect(session.accessToken).toBe(`access-for-${user.id}`);
    expect(session.refreshTokenExpiresAt).toEqual(new Date('2026-12-05T12:00:00Z'));
    expect(refreshTokens.rows).toHaveLength(1);
  });

  it('rotar entrega un token nuevo de la misma familia y retira el anterior', async () => {
    const first = await service.start(user.id);
    const second = await service.rotate(first.refreshToken, ctx);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    const [old, current] = refreshTokens.rows;
    expect(old?.replacedByTokenId).toBe(current?.id);
    expect(old?.familyId).toBe(current?.familyId);
    expect(current?.revokedAt).toBeNull();
  });

  it('reutilizar un token ya rotado revoca toda la familia y lo audita', async () => {
    const first = await service.start(user.id);
    const second = await service.rotate(first.refreshToken, ctx);

    expect(await rejectCode(service.rotate(first.refreshToken, ctx))).toBe('REFRESH_TOKEN_REUSED');
    // El token legítimo más reciente también queda inservible.
    expect(await rejectCode(service.rotate(second.refreshToken, ctx))).toBe('INVALID_SESSION');
    expect(audit.map((e) => e.action)).toEqual(['auth.refresh_token_reused']);
  });

  it('un token vencido no sirve', async () => {
    const first = await service.start(user.id);
    now = new Date('2026-12-06T00:00:00Z');
    expect(await rejectCode(service.rotate(first.refreshToken, ctx))).toBe('SESSION_EXPIRED');
  });

  it('un token desconocido no sirve', async () => {
    expect(await rejectCode(service.rotate('inventado', ctx))).toBe('INVALID_SESSION');
  });

  it('si la cuenta se suspendió, la sesión deja de servir', async () => {
    const first = await service.start(user.id);
    user.suspend();
    expect(await rejectCode(service.rotate(first.refreshToken, ctx))).toBe('INVALID_SESSION');
    expect(refreshTokens.rows.every((r) => r.revokedAt)).toBe(true);
  });

  it('cerrar sesión revoca la familia', async () => {
    const first = await service.start(user.id);
    await service.end(first.refreshToken);
    expect(await rejectCode(service.rotate(first.refreshToken, ctx))).toBe('INVALID_SESSION');
    expect(audit).toHaveLength(0);
  });
});
