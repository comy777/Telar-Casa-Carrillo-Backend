import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { bearer, PASSWORD, publishedVariant, signIn } from './support/fixtures';
import { createShippingMethod, guestOrder, shopper } from './support/shopper';
import { createTestApp, type TestApp } from './support/test-app';

const UUID = '00000000-0000-4000-8000-000000000000';

describe('Seguridad y privacidad (e2e)', () => {
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

  /** Todas las rutas de administración, tal como las publica OpenAPI. */
  const adminRoutes = () => {
    const document = SwaggerModule.createDocument(t.app, new DocumentBuilder().build());
    return Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/api/v1/admin'))
      .flatMap(([path, operations]) =>
        Object.keys(operations)
          .filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
          .map((method) => ({
            method: method as 'get' | 'post' | 'put' | 'patch' | 'delete',
            path: path.replace(/\{[^}]+\}/g, UUID).replace('{kind}', 'orders'),
          })),
      );
  };

  it('ninguna ruta de administración es accesible sin permisos', async () => {
    const routes = adminRoutes();
    expect(routes.length).toBeGreaterThan(40);
    const customer = await signIn(t, 'cliente@example.com');
    for (const route of routes) {
      const anonymous = await http()[route.method](route.path).send({});
      expect({ route, status: anonymous.status }).toEqual({ route, status: 401 });
      const forbidden = await http()[route.method](route.path).set(bearer(customer.token)).send({});
      expect({ route, status: forbidden.status }).toEqual({ route, status: 403 });
    }
  });

  it('las respuestas privadas no se guardan en caché y llevan cabeceras de seguridad', async () => {
    const user = await signIn(t, 'ana@example.com');
    const me = await http().get('/api/v1/auth/me').set(bearer(user.token)).expect(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.headers['x-content-type-options']).toBe('nosniff');
    expect(me.headers['x-powered-by']).toBeUndefined();
    const catalog = await http().get('/api/v1/catalog/products').expect(200);
    expect(catalog.headers['cache-control']).toContain('public');
  });

  it('el invitado puede enviar el token del pedido en X-Order-Token', async () => {
    const admin = (await signIn(t, 'admin@example.com', 'admin')).token;
    const methodId = await createShippingMethod(t, admin);
    const { variantId } = await publishedVariant(t, admin, { stock: 2 });
    const buyer = shopper(t);
    await buyer.add(variantId, 1).expect(200);
    const placed = (await buyer.order(guestOrder(methodId)).expect(201)).body as {
      order: { orderNumber: string };
      accessToken: string;
    };
    await http()
      .get(`/api/v1/orders/${placed.order.orderNumber}`)
      .set('X-Order-Token', placed.accessToken)
      .expect(200);
    await http()
      .get(`/api/v1/orders/${placed.order.orderNumber}/tracking`)
      .set('X-Order-Token', placed.accessToken)
      .expect(200);
  });

  describe('Ley 1581: acceso y supresión de datos', () => {
    it('el titular descarga sus datos', async () => {
      const user = await signIn(t, 'ana@example.com');
      await http()
        .post('/api/v1/account/addresses')
        .set(bearer(user.token))
        .send({
          recipient: 'Ana',
          phone: '3001234567',
          line1: 'Calle 1',
          city: 'Riohacha',
          cityDaneCode: '44001',
        })
        .expect(201);
      const data = await http().get('/api/v1/account/data').set(bearer(user.token)).expect(200);
      expect(data.headers['content-disposition']).toContain('mis-datos.json');
      expect(data.body).toMatchObject({
        account: { email: 'ana@example.com', privacyPolicyVersion: '2026-11', roles: ['customer'] },
        addresses: [{ city: 'Riohacha', department: 'La Guajira' }],
        orders: [],
      });
    });

    it('borrar la cuenta exige la contraseña, anonimiza y conserva los pedidos', async () => {
      const admin = (await signIn(t, 'admin@example.com', 'admin')).token;
      const methodId = await createShippingMethod(t, admin);
      const { variantId } = await publishedVariant(t, admin, { stock: 3 });
      const user = await signIn(t, 'ana@example.com');
      const buyer = shopper(t, user.token);
      await buyer.add(variantId, 1).expect(200);
      const placed = (await buyer.order({ ...guestOrder(methodId), email: undefined }).expect(201))
        .body as { order: { orderNumber: string } };

      // Con un pedido en curso no se puede borrar.
      const active = await http()
        .delete('/api/v1/account')
        .set(bearer(user.token))
        .send({ password: PASSWORD })
        .expect(422);
      expect(active.body).toMatchObject({ code: 'ACCOUNT_HAS_ACTIVE_ORDERS' });

      const order = await t.prisma.order.findUniqueOrThrow({
        where: { orderNumber: placed.order.orderNumber },
      });
      await http()
        .patch(`/api/v1/admin/orders/${order.id}/status`)
        .set(bearer(admin))
        .send({ status: 'CANCELLED' })
        .expect(200);
      await buyer.add(variantId, 1).expect(200);

      await http()
        .delete('/api/v1/account')
        .set(bearer(user.token))
        .send({ password: 'otra-clave-123' })
        .expect(401);
      await http()
        .delete('/api/v1/account')
        .set(bearer(user.token))
        .send({ password: PASSWORD })
        .expect(204);

      const anonymized = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(anonymized).toMatchObject({ firstName: 'Cuenta', status: 'SUSPENDED', phone: null });
      expect(anonymized.email).toMatch(/@anon\.invalid$/);
      expect(await t.prisma.cart.count({ where: { userId: user.id } })).toBe(0);
      expect(await t.prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
      // El pedido se conserva (soporte contable), ya sin cuenta asociada.
      expect(await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
        userId: null,
      });

      // La sesión deja de servir y el correo queda libre para registrarse de nuevo.
      await http().get('/api/v1/auth/me').set(bearer(user.token)).expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ana@example.com', password: PASSWORD })
        .expect(401);
      await http()
        .post('/api/v1/auth/register')
        .send({
          email: 'ana@example.com',
          password: PASSWORD,
          firstName: 'Ana',
          lastName: 'P',
          acceptTerms: true,
        })
        .expect(201);
    });

    it('un administrador no puede borrarse a sí mismo', async () => {
      const admin = await signIn(t, 'admin@example.com', 'admin');
      const response = await http()
        .delete('/api/v1/account')
        .set(bearer(admin.token))
        .send({ password: PASSWORD })
        .expect(422);
      expect(response.body).toMatchObject({ code: 'ADMIN_CANNOT_SELF_DELETE' });
    });
  });
});
