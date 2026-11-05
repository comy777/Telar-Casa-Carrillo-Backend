import request from 'supertest';
import { StockReservations } from '../src/modules/inventory/application/stock-reservations.service';
import { bearer, cookieFrom, publishedVariant, signIn } from './support/fixtures';
import { createTestApp, type TestApp } from './support/test-app';

interface CartBody {
  id: string | null;
  lines: { variantId: string; quantity: number; issues: { code: string }[]; maxQuantity: number }[];
  itemCount: number;
  subtotal: number;
  canCheckout: boolean;
  reservation: { expiresAt: string } | null;
}

describe('Carrito e inventario (e2e, base de datos real)', () => {
  let t: TestApp;
  let admin: string;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await signIn(t, 'admin@example.com', 'admin')).token;
  });

  /** Cliente invitado: guarda la cookie del carrito entre peticiones. */
  const guest = () => {
    let cookie: string | null = null;
    /** Envía con la cookie, la actualiza y permite `.expect(status)` como supertest. */
    const send = (req: request.Test) => {
      const promise = (cookie ? req.set('Cookie', cookie) : req).then((response) => {
        cookie = cookieFrom(response, 'tcc_cart') ?? cookie;
        return response;
      });
      return Object.assign(promise, {
        expect: async (status: number) => {
          const response = await promise;
          if (response.status !== status) {
            throw new Error(
              `Se esperaba ${status} y llegó ${response.status}: ${JSON.stringify(response.body)}`,
            );
          }
          return response;
        },
      });
    };
    return {
      get cookie() {
        return cookie;
      },
      get: () => send(http().get('/api/v1/cart')),
      add: (variantId: string, quantity = 1) =>
        send(http().post('/api/v1/cart/items').send({ variantId, quantity })),
      set: (variantId: string, quantity: number) =>
        send(http().patch(`/api/v1/cart/items/${variantId}`).send({ quantity })),
      reserve: () => send(http().post('/api/v1/cart/reservation')),
      release: () => send(http().delete('/api/v1/cart/reservation')),
    };
  };

  const stockOf = async (variantId: string) =>
    (await http().get(`/api/v1/admin/inventory/${variantId}`).set(bearer(admin)).expect(200))
      .body as { quantityOnHand: number; quantityReserved: number; available: number };

  describe('inventario', () => {
    it('registra entradas y conteos con su movimiento y auditoría', async () => {
      const { variantId } = await publishedVariant(t, admin);
      expect(await stockOf(variantId)).toMatchObject({ quantityOnHand: 0, available: 0 });

      await http()
        .post(`/api/v1/admin/inventory/${variantId}/receipts`)
        .set(bearer(admin))
        .send({ quantity: 5, reason: 'Lote de noviembre' })
        .expect(201);
      const counted = await http()
        .put(`/api/v1/admin/inventory/${variantId}/count`)
        .set(bearer(admin))
        .send({ quantityOnHand: 4, reason: 'Una pieza con defecto' })
        .expect(200);
      expect(counted.body).toMatchObject({ quantityOnHand: 4, availability: 'IN_STOCK' });

      const movements = await http()
        .get(`/api/v1/admin/inventory/${variantId}/movements`)
        .set(bearer(admin))
        .expect(200);
      expect(movements.body).toMatchObject({
        total: 2,
        items: [
          { type: 'ADJUSTMENT', quantity: 1, onHandAfter: 4, reason: 'Una pieza con defecto' },
          { type: 'IN', quantity: 5, onHandAfter: 5 },
        ],
      });
      const audit = await t.prisma.auditLog.findMany({ where: { resourceId: variantId } });
      expect(audit.map((a) => a.action).sort()).toEqual([
        'inventory.counted',
        'inventory.received',
      ]);
    });

    it('filtra por pocas unidades y agotados', async () => {
      const low = await publishedVariant(t, admin, { stock: 2 });
      const out = await publishedVariant(t, admin);
      await publishedVariant(t, admin, { stock: 20 });

      const skus = async (stock: string) =>
        (
          (
            await http()
              .get(`/api/v1/admin/inventory?stock=${stock}`)
              .set(bearer(admin))
              .expect(200)
          ).body as { items: { sku: string }[] }
        ).items.map((item) => item.sku);
      expect(await skus('low')).toEqual([low.sku]);
      expect(await skus('out')).toEqual([out.sku]);
    });

    it('la tienda muestra la disponibilidad y filtra por existencias', async () => {
      const low = await publishedVariant(t, admin, { stock: 2, name: 'Manta' });
      await publishedVariant(t, admin, { name: 'Ruana' });

      const detail = await http().get(`/api/v1/catalog/products/${low.slug}`).expect(200);
      expect(detail.body).toMatchObject({ variants: [{ availability: 'LOW_STOCK' }] });
      const list = await http().get('/api/v1/catalog/products?inStock=true').expect(200);
      expect(list.body).toMatchObject({
        total: 1,
        items: [{ slug: low.slug, availability: 'LOW_STOCK' }],
      });
    });

    it('exige permisos de inventario', async () => {
      const customer = await signIn(t, 'cliente@example.com');
      await http().get('/api/v1/admin/inventory').set(bearer(customer.token)).expect(403);
    });
  });

  describe('carrito', () => {
    it('un invitado tiene carrito por cookie HttpOnly con precios y stock revalidados', async () => {
      const { variantId } = await publishedVariant(t, admin, { price: 150000, stock: 3 });
      const g = guest();

      const empty = await g.get().expect(200);
      expect(empty.body).toMatchObject({ id: null, lines: [], canCheckout: false });
      expect(g.cookie).toBeNull();

      const added = await g.add(variantId, 2).expect(200);
      const raw = (added.headers['set-cookie'] as unknown as string[])[0]!;
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Lax/i);
      expect(added.headers['cache-control']).toBe('no-store');
      expect(added.body).toMatchObject({
        itemCount: 2,
        subtotal: 300000,
        canCheckout: true,
        lines: [{ variantId, quantity: 2, maxQuantity: 3, issues: [] }],
      });

      // En la base se guarda el hash, nunca la clave de la cookie.
      const key = g.cookie!.split('=')[1]!;
      const cart = await t.prisma.cart.findFirstOrThrow();
      expect(cart.guestKey).not.toBe(key);
      expect(cart.guestKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('no deja agregar más de lo disponible ni productos no publicados', async () => {
      const { variantId, productId } = await publishedVariant(t, admin, { stock: 2 });
      const g = guest();
      await g.add(variantId, 2).expect(200);
      const tooMany = await g.add(variantId, 1).expect(422);
      expect(tooMany.body).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        details: { lines: [{ variantId, requested: 3, available: 2 }] },
      });

      await http()
        .patch(`/api/v1/admin/products/${productId}/status`)
        .set(bearer(admin))
        .send({ status: 'DRAFT' })
        .expect(200);
      const cart = await g.get().expect(200);
      expect(cart.body).toMatchObject({
        canCheckout: false,
        subtotal: 0,
        lines: [{ issues: [{ code: 'UNAVAILABLE' }] }],
      });
      const draft = await g.add(variantId, 1).expect(422);
      expect(draft.body).toMatchObject({ code: 'VARIANT_NOT_AVAILABLE' });
    });

    it('avisa si el stock bajó después de agregar', async () => {
      const { variantId } = await publishedVariant(t, admin, { stock: 3 });
      const g = guest();
      await g.add(variantId, 3).expect(200);
      await http()
        .put(`/api/v1/admin/inventory/${variantId}/count`)
        .set(bearer(admin))
        .send({ quantityOnHand: 1, reason: 'Venta en feria' })
        .expect(200);

      const cart = await g.get().expect(200);
      expect(cart.body).toMatchObject({
        canCheckout: false,
        lines: [{ maxQuantity: 1, issues: [{ code: 'INSUFFICIENT_STOCK', available: 1 }] }],
      });
      // Bajar la cantidad resuelve el problema.
      const fixed = await g.set(variantId, 1).expect(200);
      expect(fixed.body).toMatchObject({ canCheckout: true });
    });

    it('al iniciar sesión, el carrito de invitado se incorpora al de la cuenta', async () => {
      const a = await publishedVariant(t, admin, { stock: 10 });
      const b = await publishedVariant(t, admin, { stock: 10 });
      const user = await signIn(t, 'cliente@example.com');

      await http()
        .post('/api/v1/cart/items')
        .set(bearer(user.token))
        .send({ variantId: a.variantId, quantity: 1 })
        .expect(200);

      const g = guest();
      await g.add(a.variantId, 2).expect(200);
      await g.add(b.variantId, 1).expect(200);

      const merged = await http()
        .get('/api/v1/cart')
        .set(bearer(user.token))
        .set('Cookie', g.cookie!)
        .expect(200);
      expect(cookieFrom(merged, 'tcc_cart')).toBeNull();
      expect((merged.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^tcc_cart=;/);
      const lines = (merged.body as CartBody).lines.map((l) => [l.variantId, l.quantity]);
      expect(lines).toEqual(
        expect.arrayContaining([
          [a.variantId, 3],
          [b.variantId, 1],
        ]),
      );
      expect(await t.prisma.cart.count()).toBe(1);
    });

    it('un token inválido da 401 en vez de tratarse como invitado', async () => {
      await http().get('/api/v1/cart').set(bearer('no-es-un-token')).expect(401);
    });
  });

  describe('reservas de checkout', () => {
    it('aparta el stock, lo libera al cambiar el carrito o al abandonar', async () => {
      const { variantId } = await publishedVariant(t, admin, { stock: 5 });
      const g = guest();
      await g.add(variantId, 2).expect(200);

      const reserved = await g.reserve().expect(200);
      expect((reserved.body as CartBody).reservation?.expiresAt).toEqual(expect.any(String));
      expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 2, available: 3 });

      // Su propia reserva no cuenta como "no disponible" para el mismo carrito.
      const cart = await g.get().expect(200);
      expect(cart.body).toMatchObject({ canCheckout: true, lines: [{ maxQuantity: 5 }] });

      // Reservar de nuevo renueva, no duplica.
      await g.reserve().expect(200);
      expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 2 });

      await g.set(variantId, 1).expect(200);
      expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 0 });

      await g.reserve().expect(200);
      await g.release().expect(200);
      expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 0, available: 5 });
    });

    it('no vende de más con checkouts simultáneos', async () => {
      const { variantId } = await publishedVariant(t, admin, { stock: 3 });
      const buyers = Array.from({ length: 8 }, () => guest());
      for (const buyer of buyers) await buyer.add(variantId, 1).expect(200);

      const results = await Promise.all(buyers.map((buyer) => buyer.reserve()));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(3);
      expect(statuses.filter((s) => s === 422)).toHaveLength(5);
      for (const failed of results.filter((r) => r.status === 422)) {
        // Según el momento: falla al apartar o ya en la revalidación previa.
        expect(['INSUFFICIENT_STOCK', 'CART_HAS_ISSUES']).toContain(
          (failed.body as { code: string }).code,
        );
      }
      expect(await stockOf(variantId)).toMatchObject({
        quantityOnHand: 3,
        quantityReserved: 3,
        available: 0,
      });
    });

    it('todo o nada: si una línea no alcanza, no aparta ninguna', async () => {
      const a = await publishedVariant(t, admin, { stock: 5 });
      const b = await publishedVariant(t, admin, { stock: 1 });
      const g = guest();
      await g.add(a.variantId, 2).expect(200);
      await g.add(b.variantId, 1).expect(200);

      // Otro cliente se lleva la última unidad de b.
      const other = guest();
      await other.add(b.variantId, 1).expect(200);
      await other.reserve().expect(200);

      const response = await g.reserve().expect(422);
      expect(response.body).toMatchObject({ code: 'CART_HAS_ISSUES' });
      expect(await stockOf(a.variantId)).toMatchObject({ quantityReserved: 0 });
    });

    it('el proceso programado libera las reservas vencidas una sola vez', async () => {
      const { variantId } = await publishedVariant(t, admin, { stock: 2 });
      const g = guest();
      await g.add(variantId, 2).expect(200);
      await g.reserve().expect(200);

      await t.prisma.stockReservation.updateMany({
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const reservations = t.app.get(StockReservations);
      // Dos procesos a la vez (p. ej. dos instancias): solo uno libera.
      const [first, second] = await Promise.all([
        reservations.releaseExpired(),
        reservations.releaseExpired(),
      ]);
      expect(first + second).toBe(1);
      expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 0, available: 2 });

      const cart = await g.get().expect(200);
      expect(cart.body).toMatchObject({ reservation: null });
      const release = await t.prisma.inventoryMovement.findFirstOrThrow({
        where: { variantId, type: 'RELEASE' },
      });
      expect(release).toMatchObject({ reason: 'expired', reservedAfter: 0 });
    });

    it('un conteo no puede dejar las existencias por debajo de lo apartado', async () => {
      const { variantId } = await publishedVariant(t, admin, { stock: 3 });
      const g = guest();
      await g.add(variantId, 3).expect(200);
      await g.reserve().expect(200);
      const response = await http()
        .put(`/api/v1/admin/inventory/${variantId}/count`)
        .set(bearer(admin))
        .send({ quantityOnHand: 2, reason: 'Conteo' })
        .expect(422);
      expect(response.body).toMatchObject({
        code: 'STOCK_BELOW_RESERVED',
        details: { reserved: 3 },
      });
    });
  });
});
