import request from 'supertest';
import { bearer, cookieFrom, PASSWORD, PNG, signIn } from './support/fixtures';
import { ADDRESS } from './support/shopper';
import { createTestApp, type TestApp } from './support/test-app';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/**
 * Recorrido completo de la tienda, como lo haría una persona real: la tienda
 * arma su catálogo, una clienta navega como invitada, inicia sesión, compra
 * con cupón, paga en la pasarela, recibe el pedido y ejerce el retracto.
 */
describe('Recorrido completo (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    await t.reset();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('del catálogo a la entrega y el reembolso', async () => {
    // 1. La tienda: artesano, categoría, producto con dos variantes, foto, stock, envío y cupón.
    const admin = (await signIn(t, 'admin@telar.co', 'admin')).token;
    const as = (req: request.Test) => req.set(bearer(admin));
    const artisan = (
      await as(http().post('/api/v1/admin/artisans')).send({ name: 'Familia Epieyú' }).expect(201)
    ).body as { id: string };
    const category = (
      await as(http().post('/api/v1/admin/categories')).send({ name: 'Mochilas' }).expect(201)
    ).body as { id: string };
    const product = (
      await as(http().post('/api/v1/admin/products'))
        .send({
          name: 'Mochila wayuu',
          sku: 'MOCH',
          description: 'Tejida a mano en La Guajira con hilo de algodón.',
          artisanId: artisan.id,
          categoryIds: [category.id],
          materials: ['Algodón'],
          variants: [
            { name: 'Grande', sku: 'MOCH-G', price: 250000 },
            { name: 'Mediana', sku: 'MOCH-M', price: 180000 },
          ],
        })
        .expect(201)
    ).body as { id: string; variants: { id: string; sku: string }[] };
    const medium = product.variants.find((v) => v.sku === 'MOCH-M')!.id;
    await as(http().post(`/api/v1/admin/products/${product.id}/images`))
      .attach('file', PNG, 'm.png')
      .expect(201);
    await as(http().patch(`/api/v1/admin/products/${product.id}/status`))
      .send({ status: 'ACTIVE' })
      .expect(200);
    for (const variant of product.variants) {
      await as(http().post(`/api/v1/admin/inventory/${variant.id}/receipts`))
        .send({ quantity: 4 })
        .expect(201);
    }
    const method = (
      await as(http().post('/api/v1/admin/shipping-methods'))
        .send({ name: 'Envío nacional', basePrice: 15000, freeShippingThreshold: 500000 })
        .expect(201)
    ).body as { id: string };
    await as(http().post('/api/v1/admin/coupons'))
      .send({ code: 'BIENVENIDA', discountType: 'PERCENTAGE', value: 10, perCustomerLimit: 1 })
      .expect(201);

    // 2. Una clienta navega como invitada y agrega al carrito.
    const search = await http()
      .get('/api/v1/catalog/products?q=mochilas&category=mochilas')
      .expect(200);
    expect(search.body).toMatchObject({
      total: 1,
      items: [{ slug: 'mochila-wayuu', price: 180000 }],
    });
    const detail = await http().get('/api/v1/catalog/products/mochila-wayuu').expect(200);
    expect(detail.body).toMatchObject({
      artisan: { name: 'Familia Epieyú' },
      materials: ['Algodón'],
    });
    const added = await http()
      .post('/api/v1/cart/items')
      .send({ variantId: medium, quantity: 2 })
      .expect(200);
    const guestCookie = cookieFrom(added, 'tcc_cart')!;

    // 3. Se registra, confirma el correo, inicia sesión y su carrito la sigue.
    await http()
      .post('/api/v1/auth/register')
      .send({
        email: 'lucia@example.com',
        password: PASSWORD,
        firstName: 'Lucía',
        lastName: 'Ipuana',
        acceptTerms: true,
      })
      .expect(201);
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: t.emails.lastToken('lucia@example.com', /Confirma/) })
      .expect(204);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'lucia@example.com', password: PASSWORD })
      .expect(200);
    const lucia = (login.body as { accessToken: string }).accessToken;
    const merged = await http()
      .get('/api/v1/cart')
      .set(bearer(lucia))
      .set('Cookie', guestCookie)
      .expect(200);
    expect(merged.body).toMatchObject({ itemCount: 2, subtotal: 360000, canCheckout: true });

    // 4. Guarda su dirección, cotiza con cupón y compra.
    const address = (
      await http().post('/api/v1/account/addresses').set(bearer(lucia)).send(ADDRESS).expect(201)
    ).body as { id: string };
    const quote = await http()
      .post('/api/v1/checkout/quote')
      .set(bearer(lucia))
      .send({ shippingMethodId: method.id, couponCode: 'bienvenida' })
      .expect(200);
    expect(quote.body).toMatchObject({
      totals: { subtotal: 360000, discount: 36000, shipping: 15000, total: 339000 },
    });
    const placed = await http()
      .post('/api/v1/checkout/orders')
      .set(bearer(lucia))
      .send({
        customerName: 'Lucía Ipuana',
        phone: '3001234567',
        document: { type: 'CC', number: '1122334455' },
        addressId: address.id,
        shippingMethodId: method.id,
        couponCode: 'BIENVENIDA',
        acceptTerms: true,
      })
      .expect(201);
    const number = (placed.body as { order: { orderNumber: string } }).order.orderNumber;
    const orderId = (await t.prisma.order.findUniqueOrThrow({ where: { orderNumber: number } })).id;

    // 5. Paga en la pasarela; el pedido se confirma con el evento firmado.
    const payment = (
      await http().post(`/api/v1/orders/${number}/payments`).set(bearer(lucia)).send({}).expect(200)
    ).body as { reference: string; checkoutUrl: string };
    expect(new URL(payment.checkoutUrl).searchParams.get('amount-in-cents')).toBe('33900000');
    const transaction = t.wompi.transaction(payment.reference, 'APPROVED', 33_900_000);
    await http()
      .post('/api/v1/payments/webhooks/wompi')
      .send(t.wompi.event(transaction))
      .expect(200);
    // Al volver del checkout, el storefront confirma (ya estaba pagado: no cambia nada).
    const confirmed = await http()
      .post(`/api/v1/orders/${number}/payments/confirm`)
      .set(bearer(lucia))
      .send({ transactionId: transaction.id })
      .expect(200);
    expect(confirmed.body).toMatchObject({ status: 'PAID' });

    // 6. La tienda factura, despacha y entrega.
    await as(http().put(`/api/v1/admin/orders/${orderId}/invoice`))
      .send({ invoiceNumber: 'FE-1', cufe: 'cufe-1' })
      .expect(200);
    const shipment = (
      await as(http().post(`/api/v1/admin/orders/${orderId}/shipments`))
        .send({ carrier: 'Servientrega', trackingNumber: '9988776655' })
        .expect(201)
    ).body as { id: string };
    await as(http().post(`/api/v1/admin/shipments/${shipment.id}/events`))
      .send({ status: 'DELIVERED' })
      .expect(201);
    const tracking = await http()
      .get(`/api/v1/orders/${number}/tracking`)
      .set(bearer(lucia))
      .expect(200);
    expect(tracking.body).toMatchObject({
      orderStatus: 'DELIVERED',
      shipments: [{ trackingNumber: '9988776655' }],
    });

    // 7. Retracto de una de las dos mochilas: reembolso parcial; el pedido sigue entregado.
    const paymentId = (await t.prisma.payment.findFirstOrThrow({ where: { orderId } })).id;
    const refund = await as(http().post(`/api/v1/admin/payments/${paymentId}/refunds`))
      .set('Idempotency-Key', 'retracto-lucia-1')
      .send({ amount: 162000, reason: 'Derecho de retracto' })
      .expect(200);
    expect(refund.body).toMatchObject({ status: 'PARTIALLY_REFUNDED' });

    // 8. Lo que ve cada parte al final.
    await settle();
    const mine = await http()
      .get(`/api/v1/account/orders/${number}`)
      .set(bearer(lucia))
      .expect(200);
    expect(mine.body).toMatchObject({
      status: 'DELIVERED',
      invoiceNumber: 'FE-1',
      couponCode: 'BIENVENIDA',
    });
    expect(t.emails.sent.filter((m) => m.to === 'lucia@example.com').map((m) => m.subject)).toEqual(
      [
        expect.stringContaining('Confirma') as unknown,
        `Recibimos tu pedido ${number}`,
        `Confirmamos el pago de tu pedido ${number}`,
        `Tu pedido ${number} va en camino`,
        `Tu pedido ${number} fue entregado`,
      ],
    );
    const stock = await as(http().get(`/api/v1/admin/inventory/${medium}`)).expect(200);
    expect(stock.body).toMatchObject({ quantityOnHand: 2, quantityReserved: 0 });
    const metrics = await as(http().get('/api/v1/admin/metrics')).expect(200);
    expect(metrics.body).toMatchObject({
      sales: {
        paidOrders: 1,
        revenue: 339000,
        discount: 36000,
        refunded: 162000,
        netRevenue: 177000,
      },
      operations: { pendingInvoices: 0, awaitingFulfillment: 0 },
    });
    const audit = await as(http().get(`/api/v1/admin/audit-logs?resource=Order`)).expect(200);
    expect((audit.body as { total: number }).total).toBeGreaterThan(0);
  });
});
