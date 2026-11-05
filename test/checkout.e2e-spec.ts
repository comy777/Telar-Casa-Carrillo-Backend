import request from 'supertest';
import { OrderLifecycle } from '../src/modules/ordering/application/orders.services';
import { OrderExpiryJob } from '../src/modules/ordering/presentation/order-expiry.job';
import { bearer, publishedVariant, signIn } from './support/fixtures';
import { ADDRESS, createShippingMethod, guestOrder, shopper } from './support/shopper';
import { createTestApp, type TestApp } from './support/test-app';

interface OrderBody {
  orderNumber: string;
  status: string;
  totals: { subtotal: number; discount: number; shipping: number; tax: number; total: number };
  items: { sku: string; quantity: number; total: number; tax: number }[];
  couponCode: string | null;
  paymentDueAt: string | null;
}

describe('Checkout y pedidos (e2e, base de datos real)', () => {
  let t: TestApp;
  let admin: string;
  let methodId: string;
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
    methodId = await createShippingMethod(t, admin, {
      basePrice: 11900,
      freeShippingThreshold: 500000,
      estimatedDelivery: '3 a 5 días hábiles',
    });
  });

  const stockOf = async (variantId: string) =>
    (await http().get(`/api/v1/admin/inventory/${variantId}`).set(bearer(admin)).expect(200))
      .body as { quantityOnHand: number; quantityReserved: number; available: number };

  const orderOf = async (number: string) =>
    t.prisma.order.findUniqueOrThrow({ where: { orderNumber: number } });

  it('un invitado compra: totales del servidor, stock apartado, carrito vacío y correo', async () => {
    const { variantId, sku } = await publishedVariant(t, admin, { price: 119000, stock: 3 });
    const buyer = shopper(t);
    await buyer.add(variantId, 2).expect(200);

    const quote = await buyer.quote({ shippingMethodId: methodId }).expect(200);
    expect(quote.body).toMatchObject({
      totals: { subtotal: 238000, discount: 0, shipping: 11900, tax: 39900, total: 249900 },
      canCheckout: true,
    });

    const placed = await buyer.order(guestOrder(methodId)).expect(201);
    const { order, accessToken } = placed.body as { order: OrderBody; accessToken: string };
    expect(order).toMatchObject({
      status: 'PENDING_PAYMENT',
      totals: { subtotal: 238000, shipping: 11900, total: 249900 },
      items: [{ sku, quantity: 2, total: 238000, tax: 38000 }],
    });
    expect(order.orderNumber).toMatch(/^TCC-\d{6}$/);
    expect(order.paymentDueAt).toEqual(expect.any(String));
    expect(accessToken).toEqual(expect.any(String));

    // El stock queda apartado a nombre del pedido y el carrito, vacío.
    expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 2, available: 1 });
    const saved = await orderOf(order.orderNumber);
    const reservation = await t.prisma.stockReservation.findFirstOrThrow();
    expect(reservation).toMatchObject({ orderId: saved.id, cartId: null, releasedAt: null });
    expect(reservation.expiresAt.getTime()).toBe(saved.paymentDueAt!.getTime());
    expect((await buyer.cart().expect(200)).body).toMatchObject({ lines: [] });
    expect(saved).toMatchObject({
      customerDocumentType: 'CC',
      customerDocumentNumber: '1020304050',
      privacyPolicyVersion: '2026-11',
    });
    expect(saved.guestAccessTokenHash).not.toBe(accessToken);

    // Correo con enlace para consultar el pedido como invitado.
    const email = t.emails.sent.find((m) => m.subject.includes(order.orderNumber))!;
    expect(email.text).toContain(`/pedido/${order.orderNumber}?token=${accessToken}`);
    await http().get(`/api/v1/orders/${order.orderNumber}?token=${accessToken}`).expect(200);
    await http()
      .get(`/api/v1/orders/${order.orderNumber}?token=${'x'.repeat(43)}`)
      .expect(404);
    await http().get(`/api/v1/orders/${order.orderNumber}`).expect(404);
  });

  it('envío gratis desde el umbral y validaciones de los datos', async () => {
    const { variantId } = await publishedVariant(t, admin, { price: 250000, stock: 5 });
    const buyer = shopper(t);
    await buyer.add(variantId, 2).expect(200);
    const quote = await buyer.quote({ shippingMethodId: methodId }).expect(200);
    expect(quote.body).toMatchObject({ totals: { shipping: 0, total: 500000 } });

    const dane = await buyer
      .order(guestOrder(methodId, { shippingAddress: { ...ADDRESS, cityDaneCode: '02001' } }))
      .expect(422);
    expect(dane.body).toMatchObject({ code: 'INVALID_DANE_CODE' });
    await buyer.order(guestOrder(methodId, { acceptTerms: false })).expect(400);
    const noEmail = await buyer.order(guestOrder(methodId, { email: undefined })).expect(422);
    expect(noEmail.body).toMatchObject({ code: 'INVALID_EMAIL' });
    // Nada de lo anterior apartó stock.
    expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 0 });
  });

  it('cupón: descuento repartido, límite de usos y devolución al cancelar', async () => {
    const { variantId } = await publishedVariant(t, admin, { price: 100000, stock: 10 });
    await http()
      .post('/api/v1/admin/coupons')
      .set(bearer(admin))
      .send({ code: 'telar10', discountType: 'PERCENTAGE', value: 10, usageLimit: 1 })
      .expect(201);

    const first = shopper(t);
    await first.add(variantId, 2).expect(200);
    const placed = await first.order(guestOrder(methodId, { couponCode: 'TELAR10' })).expect(201);
    const order = (placed.body as { order: OrderBody }).order;
    expect(order).toMatchObject({
      couponCode: 'TELAR10',
      totals: { subtotal: 200000, discount: 20000, shipping: 11900, total: 191900 },
    });

    const second = shopper(t);
    await second.add(variantId, 1).expect(200);
    const limited = await second
      .order(guestOrder(methodId, { email: 'otra@example.com', couponCode: 'telar10' }))
      .expect(422);
    expect(limited.body).toMatchObject({ code: 'COUPON_USAGE_LIMIT' });

    // Cancelar el pedido sin pagar devuelve el stock y el uso del cupón.
    const saved = await orderOf(order.orderNumber);
    await http()
      .patch(`/api/v1/admin/orders/${saved.id}/status`)
      .set(bearer(admin))
      .send({ status: 'CANCELLED', note: 'El cliente desistió' })
      .expect(200);
    expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 0, available: 10 });
    await second
      .order(guestOrder(methodId, { email: 'otra@example.com', couponCode: 'telar10' }))
      .expect(201);
  });

  it('con sesión usa una dirección guardada y solo ve sus pedidos', async () => {
    const { variantId } = await publishedVariant(t, admin, { stock: 5 });
    const ana = await signIn(t, 'ana@example.com');
    const address = await http()
      .post('/api/v1/account/addresses')
      .set(bearer(ana.token))
      .send({ ...ADDRESS, label: 'Casa' })
      .expect(201);
    expect(address.body).toMatchObject({ department: 'La Guajira', isDefault: true });

    const buyer = shopper(t, ana.token);
    await buyer.add(variantId, 1).expect(200);
    const placed = await buyer
      .order({
        customerName: 'Ana Pérez',
        phone: '3001234567',
        addressId: (address.body as { id: string }).id,
        shippingMethodId: methodId,
        acceptTerms: true,
      })
      .expect(201);
    const { order, accessToken } = placed.body as { order: OrderBody; accessToken: null };
    expect(accessToken).toBeNull();
    expect(order).toMatchObject({ customerEmail: 'ana@example.com' });

    const mine = await http().get('/api/v1/account/orders').set(bearer(ana.token)).expect(200);
    expect(mine.body).toMatchObject({ total: 1, items: [{ orderNumber: order.orderNumber }] });
    const other = await signIn(t, 'otro@example.com');
    await http()
      .get(`/api/v1/account/orders/${order.orderNumber}`)
      .set(bearer(other.token))
      .expect(404);
  });

  it('vence sin pago: se cancela y el stock vuelve', async () => {
    const { variantId } = await publishedVariant(t, admin, { stock: 2 });
    const buyer = shopper(t);
    await buyer.add(variantId, 2).expect(200);
    const order = (
      (await buyer.order(guestOrder(methodId)).expect(201)).body as { order: OrderBody }
    ).order;

    await t.prisma.order.updateMany({ data: { paymentDueAt: new Date(Date.now() - 1000) } });
    // Las reservas de pedidos no las libera el proceso de reservas de carrito.
    const saved = await orderOf(order.orderNumber);
    expect(
      await t.prisma.stockReservation.count({ where: { orderId: saved.id, releasedAt: null } }),
    ).toBe(1);

    expect(await t.app.get(OrderExpiryJob).expire()).toBe(1);
    expect(await orderOf(order.orderNumber)).toMatchObject({ status: 'CANCELLED' });
    expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 0, available: 2 });
    expect(await t.app.get(OrderExpiryJob).expire()).toBe(0);
  });

  it('pagado: descuenta inventario, avanza por estados y registra la factura', async () => {
    const { variantId } = await publishedVariant(t, admin, { stock: 3 });
    const buyer = shopper(t);
    await buyer.add(variantId, 2).expect(200);
    const order = (
      (await buyer.order(guestOrder(methodId)).expect(201)).body as { order: OrderBody }
    ).order;
    const { id } = await orderOf(order.orderNumber);
    const adminOrders = (path = '') => `/api/v1/admin/orders/${id}${path}`;

    const manualPaid = await http()
      .patch(adminOrders('/status'))
      .set(bearer(admin))
      .send({ status: 'PROCESSING' })
      .expect(422);
    expect(manualPaid.body).toMatchObject({ code: 'INVALID_ORDER_TRANSITION' });
    const early = await http()
      .put(adminOrders('/invoice'))
      .set(bearer(admin))
      .send({ invoiceNumber: 'FE-1' })
      .expect(422);
    expect(early.body).toMatchObject({ code: 'ORDER_NOT_PAID' });

    // Lo que hará el módulo de pagos al confirmar el pago.
    const lifecycle = t.app.get(OrderLifecycle);
    const paid = await lifecycle.markPaid(id, 'Pago de prueba');
    expect(paid).toMatchObject({ shortages: [], alreadyPaid: false });
    expect((await lifecycle.markPaid(id, 'Repetido')).alreadyPaid).toBe(true);
    expect(await stockOf(variantId)).toMatchObject({ quantityOnHand: 1, quantityReserved: 0 });

    const pending = await http()
      .get('/api/v1/admin/orders?invoicePending=true')
      .set(bearer(admin))
      .expect(200);
    expect(pending.body).toMatchObject({ total: 1 });
    await http()
      .put(adminOrders('/invoice'))
      .set(bearer(admin))
      .send({ invoiceNumber: 'FE-1', cufe: 'abc123' })
      .expect(200);

    for (const status of ['PROCESSING', 'SHIPPED', 'DELIVERED']) {
      await http().patch(adminOrders('/status')).set(bearer(admin)).send({ status }).expect(200);
    }
    const detail = await http().get(adminOrders()).set(bearer(admin)).expect(200);
    expect(detail.body).toMatchObject({
      status: 'DELIVERED',
      invoiceNumber: 'FE-1',
      history: [
        { status: 'PENDING_PAYMENT' },
        { status: 'PAID' },
        { status: 'PROCESSING' },
        { status: 'SHIPPED' },
        { status: 'DELIVERED' },
      ],
    });
  });

  it('no vende de más con pedidos simultáneos de la última unidad', async () => {
    const { variantId } = await publishedVariant(t, admin, { stock: 1 });
    const buyers = [shopper(t), shopper(t), shopper(t)];
    for (const buyer of buyers) await buyer.add(variantId, 1).expect(200);
    const results = await Promise.all(
      buyers.map((buyer, i) => buyer.order(guestOrder(methodId, { email: `c${i}@example.com` }))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 422, 422]);
    expect(await t.prisma.order.count()).toBe(1);
    expect(await stockOf(variantId)).toMatchObject({ quantityReserved: 1, available: 0 });
  });
});
