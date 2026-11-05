import request, { type Response } from 'supertest';
import { createTestApp, type TestApp } from './support/test-app';

const PASSWORD = 'telar de la abuela 2026';

describe('Identidad (e2e, base de datos real)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  // ---------- utilidades ----------

  const register = (email: string, overrides: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/auth/register')
      .send({
        email,
        password: PASSWORD,
        firstName: 'Ana',
        lastName: 'Pérez',
        acceptTerms: true,
        ...overrides,
      });

  const verify = (email: string) =>
    http()
      .post('/api/v1/auth/verify-email')
      .send({ token: t.emails.lastToken(email, /Confirma/) });

  const login = (email: string, password = PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });

  const refreshCookie = (response: Response): string => {
    const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = raw?.find((c) => c.startsWith('tcc_refresh=') && !c.startsWith('tcc_refresh=;'));
    if (!cookie) throw new Error('La respuesta no trae la cookie de sesión');
    return cookie.split(';')[0]!;
  };

  /** Usuario registrado, verificado y con sesión iniciada. */
  const signedIn = async (email: string) => {
    await register(email).expect(201);
    await verify(email).expect(204);
    const response = await login(email).expect(200);
    return {
      id: (response.body as { user: { id: string } }).user.id,
      accessToken: (response.body as { accessToken: string }).accessToken,
      cookie: refreshCookie(response),
    };
  };

  const makeAdmin = async (userId: string) => {
    const role = await t.prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
    await t.prisma.userRole.create({ data: { userId, roleId: role.id } });
  };

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  // ---------- registro y verificación ----------

  describe('registro', () => {
    it('crea la cuenta pendiente, envía el correo y guarda el consentimiento', async () => {
      const response = await register('Ana@Example.com').expect(201);
      const { userId } = response.body as { userId: string };

      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user).toMatchObject({
        email: 'ana@example.com',
        status: 'PENDING_VERIFICATION',
        privacyPolicyVersion: '2026-11',
      });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.privacyPolicyAcceptedAt).not.toBeNull();
      expect(t.emails.sent[0]?.text).toContain(
        'http://localhost:3000/cuenta/verificar-correo?token=',
      );
    });

    it('no permite dos cuentas con el mismo correo, aunque cambien las mayúsculas', async () => {
      await register('ana@example.com').expect(201);
      const response = await register('ANA@example.com').expect(409);
      expect(response.body).toMatchObject({ code: 'EMAIL_TAKEN' });
    });

    it('exige aceptar los términos', async () => {
      const response = await register('ana@example.com', { acceptTerms: false }).expect(422);
      expect(response.body).toMatchObject({ code: 'TERMS_NOT_ACCEPTED' });
    });

    it('rechaza campos no declarados y contraseñas cortas', async () => {
      await register('ana@example.com', { isAdmin: true }).expect(400);
      const response = await register('ana@example.com', { password: 'corta' }).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('no deja iniciar sesión hasta confirmar el correo', async () => {
      await register('ana@example.com').expect(201);
      const response = await login('ana@example.com').expect(403);
      expect(response.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    });

    it('el enlace de verificación sirve una sola vez', async () => {
      await register('ana@example.com').expect(201);
      const token = t.emails.lastToken('ana@example.com', /Confirma/);
      await http().post('/api/v1/auth/verify-email').send({ token }).expect(204);
      const response = await http().post('/api/v1/auth/verify-email').send({ token }).expect(422);
      expect(response.body).toMatchObject({ code: 'INVALID_OR_EXPIRED_TOKEN' });
    });

    it('reenviar la verificación invalida el enlace anterior y no revela si el correo existe', async () => {
      await register('ana@example.com').expect(201);
      const first = t.emails.lastToken('ana@example.com', /Confirma/);
      await http()
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'ana@example.com' })
        .expect(202);
      await http()
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'nadie@example.com' })
        .expect(202);

      expect(t.emails.sent).toHaveLength(2);
      await http().post('/api/v1/auth/verify-email').send({ token: first }).expect(422);
      await verify('ana@example.com').expect(204);
    });
  });

  // ---------- inicio de sesión y sesiones ----------

  describe('sesión', () => {
    it('inicia sesión con access token y cookie HttpOnly', async () => {
      await register('ana@example.com').expect(201);
      await verify('ana@example.com').expect(204);
      const response = await login('ana@example.com').expect(200);

      expect(response.body).toMatchObject({
        expiresIn: 900,
        user: { email: 'ana@example.com', status: 'ACTIVE', roles: ['customer'], permissions: [] },
      });
      const setCookie = (response.headers['set-cookie'] as unknown as string[]).join(';');
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
      expect(setCookie).toMatch(/Path=\/api\/v1\/auth/i);
    });

    it('/auth/me devuelve el usuario con un access token válido', async () => {
      const { accessToken } = await signedIn('ana@example.com');
      const response = await http().get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);
      expect(response.body).toMatchObject({ email: 'ana@example.com', roles: ['customer'] });
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('sin token o con un token alterado responde 401', async () => {
      await http().get('/api/v1/auth/me').expect(401);
      const { accessToken } = await signedIn('ana@example.com');
      const response = await http()
        .get('/api/v1/auth/me')
        .set(bearer(`${accessToken.slice(0, -2)}xx`))
        .expect(401);
      expect(response.body).toMatchObject({ code: 'INVALID_ACCESS_TOKEN' });
    });

    it('responde igual a contraseña incorrecta y a correo inexistente', async () => {
      await signedIn('ana@example.com');
      const wrong = await login('ana@example.com', 'otra contraseña larga').expect(401);
      const unknown = await login('nadie@example.com').expect(401);
      expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(unknown.body).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        detail: (wrong.body as { detail: string }).detail,
      });

      const failures = await t.prisma.auditLog.count({ where: { action: 'auth.login_failed' } });
      expect(failures).toBe(2);
    });

    it('refresh rota la cookie; reutilizar la anterior cierra la sesión', async () => {
      const { cookie: first } = await signedIn('ana@example.com');

      const refreshed = await http().post('/api/v1/auth/refresh').set('Cookie', first).expect(200);
      const second = refreshCookie(refreshed);
      expect(second).not.toBe(first);
      expect(refreshed.body).toHaveProperty('accessToken');

      const reused = await http().post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
      expect(reused.body).toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
      // La sesión legítima también quedó revocada.
      await http().post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
    });

    it('logout revoca la sesión', async () => {
      const { cookie } = await signedIn('ana@example.com');
      await http().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
      await http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('refresh sin cookie responde 401', async () => {
      const response = await http().post('/api/v1/auth/refresh').expect(401);
      expect(response.body).toMatchObject({ code: 'MISSING_REFRESH_TOKEN' });
    });
  });

  // ---------- recuperación de contraseña ----------

  describe('recuperación de contraseña', () => {
    it('no revela si el correo existe', async () => {
      await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nadie@example.com' })
        .expect(202);
      expect(t.emails.sent).toHaveLength(0);
    });

    it('cambia la contraseña, cierra las sesiones y el enlace no se puede reusar', async () => {
      const { cookie } = await signedIn('ana@example.com');
      await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'ana@example.com' })
        .expect(202);
      const token = t.emails.lastToken('ana@example.com', /Restablece/);
      const newPassword = 'otra frase bastante larga';

      await http()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: newPassword })
        .expect(204);

      await login('ana@example.com').expect(401);
      await login('ana@example.com', newPassword).expect(200);
      await http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
      await http()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'una tercera frase larga' })
        .expect(422);
    });

    it('restablecer también confirma un correo pendiente', async () => {
      await register('ana@example.com').expect(201);
      await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'ana@example.com' })
        .expect(202);
      const token = t.emails.lastToken('ana@example.com', /Restablece/);
      await http()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: PASSWORD })
        .expect(204);
      await login('ana@example.com').expect(200);
    });
  });

  // ---------- administración ----------

  describe('administración', () => {
    it('un cliente no puede entrar al panel', async () => {
      const { accessToken } = await signedIn('ana@example.com');
      const response = await http().get('/api/v1/admin/users').set(bearer(accessToken)).expect(403);
      expect(response.body).toMatchObject({
        code: 'MISSING_PERMISSION',
        details: { missing: ['users:read'] },
      });
    });

    it('un administrador lista y busca usuarios sin ver los hashes', async () => {
      const admin = await signedIn('admin@example.com');
      await makeAdmin(admin.id);
      await signedIn('ana@example.com');

      // Ambos se llaman "Ana": la búsqueda por nombre devuelve los dos y por correo solo uno.
      const byName = await http()
        .get('/api/v1/admin/users?search=ANA')
        .set(bearer(admin.accessToken))
        .expect(200);
      expect(byName.body).toMatchObject({ total: 2 });

      const response = await http()
        .get('/api/v1/admin/users')
        .query({ search: 'ana@', pageSize: 5 })
        .set(bearer(admin.accessToken))
        .expect(200);
      expect(response.body).toMatchObject({
        total: 1,
        page: 1,
        pageSize: 5,
        items: [{ email: 'ana@example.com', roles: ['customer'] }],
      });
      expect(JSON.stringify(response.body)).not.toContain('argon2');
    });

    it('suspender corta el acceso de inmediato y queda auditado', async () => {
      const admin = await signedIn('admin@example.com');
      await makeAdmin(admin.id);
      const ana = await signedIn('ana@example.com');

      await http()
        .patch(`/api/v1/admin/users/${ana.id}/status`)
        .set(bearer(admin.accessToken))
        .send({ action: 'suspend' })
        .expect(200);

      // El access token de Ana sigue sin vencer, pero la cuenta ya no está activa.
      await http().get('/api/v1/auth/me').set(bearer(ana.accessToken)).expect(401);
      await http().post('/api/v1/auth/refresh').set('Cookie', ana.cookie).expect(401);
      const relogin = await login('ana@example.com').expect(403);
      expect(relogin.body).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });

      const audit = await http()
        .get(`/api/v1/admin/audit-logs?action=user.suspended`)
        .set(bearer(admin.accessToken))
        .expect(200);
      expect(audit.body).toMatchObject({
        total: 1,
        items: [
          {
            actorEmail: 'admin@example.com',
            resourceId: ana.id,
            metadata: { from: 'ACTIVE', to: 'SUSPENDED' },
          },
        ],
      });

      await http()
        .patch(`/api/v1/admin/users/${ana.id}/status`)
        .set(bearer(admin.accessToken))
        .send({ action: 'reactivate' })
        .expect(200);
      await login('ana@example.com').expect(200);
    });

    it('un administrador no puede suspenderse ni quitarse el rol de administrador', async () => {
      const admin = await signedIn('admin@example.com');
      await makeAdmin(admin.id);

      const suspend = await http()
        .patch(`/api/v1/admin/users/${admin.id}/status`)
        .set(bearer(admin.accessToken))
        .send({ action: 'suspend' })
        .expect(422);
      expect(suspend.body).toMatchObject({ code: 'CANNOT_CHANGE_OWN_STATUS' });

      const roles = await http()
        .put(`/api/v1/admin/users/${admin.id}/roles`)
        .set(bearer(admin.accessToken))
        .send({ roles: ['customer'] })
        .expect(422);
      expect(roles.body).toMatchObject({ code: 'CANNOT_REMOVE_OWN_ADMIN' });
    });

    it('asignar roles cambia los permisos efectivos', async () => {
      const admin = await signedIn('admin@example.com');
      await makeAdmin(admin.id);
      const ana = await signedIn('ana@example.com');

      await http()
        .put(`/api/v1/admin/users/${ana.id}/roles`)
        .set(bearer(admin.accessToken))
        .send({ roles: ['customer', 'inventado'] })
        .expect(422);

      await http()
        .put(`/api/v1/admin/users/${ana.id}/roles`)
        .set(bearer(admin.accessToken))
        .send({ roles: ['customer', 'admin'] })
        .expect(200);

      const me = await http().get('/api/v1/auth/me').set(bearer(ana.accessToken)).expect(200);
      expect(me.body).toMatchObject({
        roles: ['admin', 'customer'],
        permissions: ['audit:read', 'roles:read', 'users:manage', 'users:read'],
      });
    });

    it('lista los roles con sus permisos', async () => {
      const admin = await signedIn('admin@example.com');
      await makeAdmin(admin.id);
      const response = await http()
        .get('/api/v1/admin/roles')
        .set(bearer(admin.accessToken))
        .expect(200);
      expect(response.body).toEqual([
        expect.objectContaining({ name: 'admin', userCount: 1 }),
        expect.objectContaining({ name: 'customer', permissions: [], userCount: 1 }),
      ]);
    });

    it('un id que no es UUID responde 400', async () => {
      const admin = await signedIn('admin@example.com');
      await makeAdmin(admin.id);
      await http().get('/api/v1/admin/users/123').set(bearer(admin.accessToken)).expect(400);
    });
  });
});
