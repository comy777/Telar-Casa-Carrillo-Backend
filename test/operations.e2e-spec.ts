import request from 'supertest';
import { bearer, publishedVariant, signIn } from './support/fixtures';
import { createShippingMethod, guestOrder, shopper } from './support/shopper';
import { createTestApp, type TestApp } from './support/test-app';

let products = 0;

/** Espera a que terminen las tareas posteriores al commit (correos). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('Seguimiento, notificaciones, métricas y reportes (e2e)', () => {
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
    methodId = await createShippingMethod(t, admin, { basePrice: 10000 });
  });

  /** Pedido de invitado pagado por la pasarela (evento firmado). */
  const paidOrder = async (options: { stock?: number; quantity?: number } = {}) => {
    const { variantId } = await publishedVariant(t, admin, {
      price: 100000,
      stock: options.stock ?? 5,
      name: `Hamaca sanjacintera ${++products}`,
    });
    const buyer = shopper(t);
    await buyer.add(variantId, options.quantity ?? 2).expect(200);
    const placed = (await buyer.order(guestOrder(methodId)).expect(201)).body as {
      order: { orderNumber: string; totals: { total: number } };
      accessToken: string;
    };
    const number = placed.order.orderNumber;
    const payment = (
      await http()
        .post(`/api/v1/orders/${number}/payments`)
        .send({ token: placed.accessToken })
        .expect(200)
    ).body as { reference: string };
    const transaction = t.wompi.transaction(
      payment.reference,
      'APPROVED',
      placed.order.totals.total * 100,
    );
    await http()
      .post('/api/v1/payments/webhooks/wompi')
      .send(t.wompi.event(transaction))
      .expect(200);
    const order = await t.prisma.order.findUniqueOrThrow({ where: { orderNumber: number } });
    await settle();
    return { id: order.id, number, token: placed.accessToken, variantId };
  };

  const subjects = (to: string) => t.emails.sent.filter((m) => m.to === to).map((m) => m.subject);

  it('el cliente recibe correos de cada paso y sigue el envío con su token', async () => {
    const order = await paidOrder();
    expect(subjects('ana@example.com')).toEqual([
      `Recibimos tu pedido ${order.number}`,
      `Confirmamos el pago de tu pedido ${order.number}`,
    ]);

    // Sin guía el envío queda listo y el pedido en preparación.
    const shipment = await http()
      .post(`/api/v1/admin/orders/${order.id}/shipments`)
      .set(bearer(admin))
      .send({ carrier: 'Servientrega' })
      .expect(201);
    const shipmentId = (shipment.body as { id: string; status: string }).id;
    expect(shipment.body).toMatchObject({ status: 'READY' });
    expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PROCESSING',
    );

    await http()
      .post(`/api/v1/admin/shipments/${shipmentId}/events`)
      .set(bearer(admin))
      .send({
        status: 'IN_TRANSIT',
        description: 'Recogido en el taller',
        carrierStatus: 'ADMITIDO',
      })
      .expect(201);
    await settle();
    expect(subjects('ana@example.com')).toContain(`Tu pedido ${order.number} va en camino`);

    const invalid = await http()
      .post(`/api/v1/admin/shipments/${shipmentId}/events`)
      .set(bearer(admin))
      .send({ status: 'READY' })
      .expect(422);
    expect(invalid.body).toMatchObject({ code: 'INVALID_SHIPMENT_TRANSITION' });

    await http()
      .post(`/api/v1/admin/shipments/${shipmentId}/events`)
      .set(bearer(admin))
      .send({ status: 'DELIVERED', description: 'Entregado a Ana' })
      .expect(201);
    await settle();

    const tracking = await http()
      .get(`/api/v1/orders/${order.number}/tracking?token=${order.token}`)
      .expect(200);
    expect(tracking.body).toMatchObject({
      orderStatus: 'DELIVERED',
      shipments: [
        {
          carrier: 'Servientrega',
          status: 'DELIVERED',
          events: [
            { status: 'READY' },
            { status: 'IN_TRANSIT', carrierStatus: 'ADMITIDO' },
            { status: 'DELIVERED' },
          ],
        },
      ],
    });
    await http().get(`/api/v1/orders/${order.number}/tracking`).expect(404);
    expect(subjects('ana@example.com')).toContain(`Tu pedido ${order.number} fue entregado`);

    const history = await t.prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.to)).toEqual([
      'PENDING_PAYMENT',
      'PAID',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
    ]);
  });

  it('con guía al despachar, el pedido pasa directo a enviado', async () => {
    const order = await paidOrder();
    await http()
      .post(`/api/v1/admin/orders/${order.id}/shipments`)
      .set(bearer(admin))
      .send({ carrier: 'Coordinadora', trackingNumber: '2048193377' })
      .expect(201);
    expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'SHIPPED',
    );
    await settle();
    const shipped = t.emails.sent.find((m) => m.subject.includes('va en camino'))!;
    expect(shipped.text).toContain('Coordinadora: guía 2048193377');
  });

  it('un pedido sin pagar no se despacha', async () => {
    const { variantId } = await publishedVariant(t, admin, { stock: 1 });
    const buyer = shopper(t);
    await buyer.add(variantId, 1).expect(200);
    const number = (
      (await buyer.order(guestOrder(methodId)).expect(201)).body as {
        order: { orderNumber: string };
      }
    ).order.orderNumber;
    const { id } = await t.prisma.order.findUniqueOrThrow({ where: { orderNumber: number } });
    const response = await http()
      .post(`/api/v1/admin/orders/${id}/shipments`)
      .set(bearer(admin))
      .send({ carrier: 'Servientrega' })
      .expect(422);
    expect(response.body).toMatchObject({ code: 'ORDER_NOT_SHIPPABLE' });
  });

  it('métricas de ventas y pendientes de operación', async () => {
    await paidOrder({ quantity: 2 });
    await paidOrder({ quantity: 1 });

    const today = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
    const metrics = await http()
      .get(`/api/v1/admin/metrics?from=${today}&to=${today}`)
      .set(bearer(admin))
      .expect(200);
    expect(metrics.body).toMatchObject({
      sales: {
        paidOrders: 2,
        revenue: 320000,
        shipping: 20000,
        refunded: 0,
        netRevenue: 320000,
        averageOrder: 160000,
      },
      ordersByStatus: { PAID: 2 },
      salesByDay: [{ day: today, orders: 2, revenue: 320000 }],
      operations: { awaitingFulfillment: 2, pendingInvoices: 2, paymentsNeedingReview: 0 },
    });
    expect((metrics.body as { topProducts: unknown[] }).topProducts).toHaveLength(2);

    await http()
      .get('/api/v1/admin/metrics?from=2026-12-01&to=2026-11-01')
      .set(bearer(admin))
      .expect(422);
    const customer = await signIn(t, 'cliente@example.com');
    await http().get('/api/v1/admin/metrics').set(bearer(customer.token)).expect(403);
  });

  it('exporta CSV de pedidos, líneas e inventario', async () => {
    const order = await paidOrder();
    const today = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);

    const orders = await http()
      .get(`/api/v1/admin/reports/orders.csv?from=${today}&to=${today}&delimiter=;`)
      .set(bearer(admin))
      .expect(200);
    expect(orders.headers['content-type']).toMatch(/text\/csv/);
    expect(orders.headers['content-disposition']).toMatch(/attachment; filename="orders-.*\.csv"/);
    const [header, row] = orders.text.replace(String.fromCharCode(0xfeff), '').split('\r\n');
    expect(header).toContain('pedido;fecha;estado');
    expect(row).toContain(`${order.number};`);
    expect(row).toContain(';PAID;');
    expect(row).toContain('La Guajira');

    const items = await http()
      .get(`/api/v1/admin/reports/order-items.csv?from=${today}&to=${today}`)
      .set(bearer(admin))
      .expect(200);
    expect(items.text).toContain('tarifa_iva');
    expect(items.text).toContain('Hamaca sanjacintera');

    const inventory = await http()
      .get('/api/v1/admin/reports/inventory.csv')
      .set(bearer(admin))
      .expect(200);
    expect(inventory.text.split('\r\n')[1]).toContain('Hamaca sanjacintera');
  });

  it('estado del sistema y alertas a la tienda', async () => {
    const status = await http().get('/api/v1/admin/system/status').set(bearer(admin)).expect(200);
    expect(status.body).toMatchObject({
      healthy: true,
      signals: { failedWebhooks: 0, overdueUnpaidOrders: 0 },
      jobs: expect.arrayContaining([
        expect.objectContaining({ name: 'ReservationExpiryJob', enabled: false }),
        expect.objectContaining({ name: 'OrderExpiryJob' }),
      ]) as unknown,
    });

    // Un pedido vencido sin cancelar indica que el proceso de vencimiento no corre.
    const { variantId } = await publishedVariant(t, admin, { stock: 2 });
    const buyer = shopper(t);
    await buyer.add(variantId, 1).expect(200);
    await buyer.order(guestOrder(methodId)).expect(201);
    await t.prisma.order.updateMany({ data: { paymentDueAt: new Date(Date.now() - 3_600_000) } });
    const unhealthy = await http()
      .get('/api/v1/admin/system/status')
      .set(bearer(admin))
      .expect(200);
    expect(unhealthy.body).toMatchObject({ healthy: false, signals: { overdueUnpaidOrders: 1 } });
  });
});
