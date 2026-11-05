import request from 'supertest';
import { PaymentsService } from '../src/modules/payments/application/payments.service';
import { OrderExpiryJob } from '../src/modules/ordering/presentation/order-expiry.job';
import { bearer, publishedVariant, signIn } from './support/fixtures';
import { createShippingMethod, guestOrder, shopper } from './support/shopper';
import { createTestApp, type TestApp } from './support/test-app';

interface Placed {
  number: string;
  token: string;
  id: string;
  totalCents: number;
  variantId: string;
}

describe('Pagos con Wompi (e2e, base de datos real)', () => {
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

  /** Pedido de invitado listo para pagar: 2 × 100.000 + 10.000 de envío. */
  const placeOrder = async (stock = 5): Promise<Placed> => {
    const { variantId } = await publishedVariant(t, admin, { price: 100000, stock });
    const buyer = shopper(t);
    await buyer.add(variantId, 2).expect(200);
    const placed = await buyer.order(guestOrder(methodId)).expect(201);
    const body = placed.body as { order: { orderNumber: string }; accessToken: string };
    const order = await t.prisma.order.findUniqueOrThrow({
      where: { orderNumber: body.order.orderNumber },
    });
    return {
      number: body.order.orderNumber,
      token: body.accessToken,
      id: order.id,
      totalCents: 21_000_000,
      variantId,
    };
  };

  const startPayment = async (order: Placed) => {
    const response = await http()
      .post(`/api/v1/orders/${order.number}/payments`)
      .send({ token: order.token })
      .expect(200);
    return response.body as {
      reference: string;
      checkoutUrl: string;
      widget: { amountInCents: number };
    };
  };

  const webhook = (body: object) => http().post('/api/v1/payments/webhooks/wompi').send(body);
  const statusOf = async (id: string) =>
    (await t.prisma.order.findUniqueOrThrow({ where: { id } })).status;
  const stockOf = async (variantId: string) =>
    (await http().get(`/api/v1/admin/inventory/${variantId}`).set(bearer(admin)).expect(200))
      .body as { quantityOnHand: number; quantityReserved: number };

  it('inicia el pago con la firma de integridad y el monto del servidor', async () => {
    const order = await placeOrder();
    const payment = await startPayment(order);
    const url = new URL(payment.checkoutUrl);
    expect(url.searchParams.get('amount-in-cents')).toBe('21000000');
    expect(url.searchParams.get('reference')).toBe(payment.reference);
    expect(url.searchParams.get('signature:integrity')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('redirect-url')).toMatch(
      new RegExp(`/pedido/${order.number}/pago$`),
    );
    expect(payment.reference).toMatch(new RegExp(`^${order.number}-[0-9A-F]{8}$`));

    // Sin el token del correo no se puede iniciar el pago de otro.
    await http().post(`/api/v1/orders/${order.number}/payments`).send({}).expect(404);
  });

  it('el evento firmado aprobado marca pagado y descuenta inventario una sola vez', async () => {
    const order = await placeOrder();
    const { reference } = await startPayment(order);
    const approved = t.wompi.transaction(reference, 'APPROVED', order.totalCents);
    const event = t.wompi.event(approved);

    await webhook(event).expect(200);
    expect(await statusOf(order.id)).toBe('PAID');
    expect(await stockOf(order.variantId)).toMatchObject({
      quantityOnHand: 3,
      quantityReserved: 0,
    });

    // Reenvío del mismo evento (Wompi reintenta): no cambia nada.
    await webhook(event).expect(200);
    expect(await t.prisma.webhookEvent.count()).toBe(1);
    expect(await t.prisma.inventoryMovement.count({ where: { type: 'OUT' } })).toBe(1);
    const payment = await t.prisma.payment.findFirstOrThrow();
    expect(payment).toMatchObject({
      status: 'APPROVED',
      providerReference: approved.id,
      reviewReason: null,
    });

    // El cliente ve el pedido pagado con su token.
    const view = await http()
      .get(`/api/v1/orders/${order.number}?token=${order.token}`)
      .expect(200);
    expect(view.body).toMatchObject({ status: 'PAID' });
  });

  it('rechaza eventos sin firma válida pero los guarda', async () => {
    const order = await placeOrder();
    const { reference } = await startPayment(order);
    const forged = t.wompi.event(
      t.wompi.transaction(reference, 'APPROVED', order.totalCents),
      'otro',
    );

    const response = await webhook(forged).expect(401);
    expect(response.body).toMatchObject({ code: 'INVALID_SIGNATURE' });
    expect(await statusOf(order.id)).toBe('PENDING_PAYMENT');
    expect(await t.prisma.webhookEvent.findFirstOrThrow()).toMatchObject({
      signatureValid: false,
      processedAt: null,
    });
  });

  it('al volver de la pasarela consulta la transacción, no confía en el navegador', async () => {
    const order = await placeOrder();
    const { reference } = await startPayment(order);
    const pending = t.wompi.transaction(reference, 'PENDING', order.totalCents);
    const confirm = (transactionId: string) =>
      http()
        .post(`/api/v1/orders/${order.number}/payments/confirm`)
        .send({ token: order.token, transactionId });

    expect((await confirm(pending.id).expect(200)).body).toMatchObject({
      status: 'PENDING_PAYMENT',
    });
    t.wompi.transaction(reference, 'APPROVED', order.totalCents, pending.id);
    expect((await confirm(pending.id).expect(200)).body).toMatchObject({ status: 'PAID' });

    // Una transacción de otro pedido no sirve para este.
    const other = await placeOrder();
    const otherPayment = await startPayment(other);
    const foreign = t.wompi.transaction(otherPayment.reference, 'APPROVED', other.totalCents);
    await http()
      .post(`/api/v1/orders/${order.number}/payments/confirm`)
      .send({ token: order.token, transactionId: foreign.id })
      .expect(404);
    await confirm('no-existe-123').expect(404);
  });

  it('un rechazo deja reintentar con otra referencia', async () => {
    const order = await placeOrder();
    const first = await startPayment(order);
    await webhook(
      t.wompi.event(t.wompi.transaction(first.reference, 'DECLINED', order.totalCents)),
    ).expect(200);
    expect(await statusOf(order.id)).toBe('PENDING_PAYMENT');

    const second = await startPayment(order);
    expect(second.reference).not.toBe(first.reference);
    await webhook(
      t.wompi.event(t.wompi.transaction(second.reference, 'APPROVED', order.totalCents)),
    ).expect(200);
    expect(await statusOf(order.id)).toBe('PAID');
    await http()
      .post(`/api/v1/orders/${order.number}/payments`)
      .send({ token: order.token })
      .expect(422);
  });

  it('un monto distinto no marca pagado y queda para revisión', async () => {
    const order = await placeOrder();
    const { reference } = await startPayment(order);
    await webhook(t.wompi.event(t.wompi.transaction(reference, 'APPROVED', 100))).expect(200);
    expect(await statusOf(order.id)).toBe('PENDING_PAYMENT');
    const review = await http()
      .get('/api/v1/admin/payments?needsReview=true')
      .set(bearer(admin))
      .expect(200);
    expect(review.body).toMatchObject({ total: 1, items: [{ reviewReason: 'AMOUNT_MISMATCH' }] });
  });

  it('pago tardío de un pedido vencido: se marca para revisión y se reembolsa', async () => {
    const order = await placeOrder();
    const { reference } = await startPayment(order);
    await t.prisma.order.update({
      where: { id: order.id },
      data: { paymentDueAt: new Date(Date.now() - 1000) },
    });
    expect(await t.app.get(OrderExpiryJob).expire()).toBe(1);

    await webhook(
      t.wompi.event(t.wompi.transaction(reference, 'APPROVED', order.totalCents)),
    ).expect(200);
    expect(await statusOf(order.id)).toBe('CANCELLED');
    const payment = await t.prisma.payment.findFirstOrThrow();
    expect(payment).toMatchObject({ status: 'APPROVED', reviewReason: 'ORDER_NOT_PAYABLE' });

    const refunded = await http()
      .post(`/api/v1/admin/payments/${payment.id}/refunds`)
      .set(bearer(admin))
      .set('Idempotency-Key', 'late-payment-1')
      .send({ reason: 'Pago tardío' })
      .expect(200);
    expect(refunded.body).toMatchObject({
      status: 'REFUNDED',
      refunds: [{ status: 'APPROVED', amount: 210000 }],
    });
    expect(t.wompi.refundRequests).toEqual([
      expect.objectContaining({
        amount_in_cents: 21_000_000,
        transaction_id: payment.providerReference,
      }),
    ]);
    expect(await statusOf(order.id)).toBe('CANCELLED');
  });

  it('reembolso parcial y luego total: cancela el pedido y devuelve el stock', async () => {
    const order = await placeOrder();
    const { reference } = await startPayment(order);
    await webhook(
      t.wompi.event(t.wompi.transaction(reference, 'APPROVED', order.totalCents)),
    ).expect(200);
    const payment = await t.prisma.payment.findFirstOrThrow();
    const refund = (key: string, body: Record<string, unknown>) =>
      http()
        .post(`/api/v1/admin/payments/${payment.id}/refunds`)
        .set(bearer(admin))
        .set('Idempotency-Key', key)
        .send(body);

    const partial = await refund('refund-partial-1', {
      amount: 50000,
      reason: 'Pieza con defecto',
    }).expect(200);
    expect(partial.body).toMatchObject({ status: 'PARTIALLY_REFUNDED' });
    expect(await statusOf(order.id)).toBe('PAID');
    // Repetir con la misma clave no duplica el reembolso.
    await refund('refund-partial-1', { amount: 50000, reason: 'Pieza con defecto' }).expect(200);
    expect(t.wompi.refundRequests).toHaveLength(1);

    const tooMuch = await refund('refund-too-much', { amount: 200000, reason: 'x' }).expect(422);
    expect(tooMuch.body).toMatchObject({
      code: 'REFUND_EXCEEDS_PAYMENT',
      details: { remaining: 160000 },
    });

    const rest = await refund('refund-rest-1', {
      reason: 'Retracto del cliente',
      restock: true,
    }).expect(200);
    expect(rest.body).toMatchObject({ status: 'REFUNDED' });
    expect(await statusOf(order.id)).toBe('CANCELLED');
    expect(await stockOf(order.variantId)).toMatchObject({ quantityOnHand: 5 });
    await http().get(`/api/v1/admin/payments/${payment.id}`).set(bearer(admin)).expect(200);
  });

  it('un reembolso en curso se confirma a mano', async () => {
    const order = await placeOrder();
    const { reference } = await startPayment(order);
    await webhook(
      t.wompi.event(t.wompi.transaction(reference, 'APPROVED', order.totalCents)),
    ).expect(200);
    const payment = await t.prisma.payment.findFirstOrThrow();
    t.wompi.refundStatus = 'PENDING';
    const pending = await http()
      .post(`/api/v1/admin/payments/${payment.id}/refunds`)
      .set(bearer(admin))
      .set('Idempotency-Key', 'pending-refund-1')
      .send({ reason: 'Retracto' })
      .expect(200);
    const refundId = (pending.body as { refunds: { id: string; status: string }[] }).refunds[0]!;
    expect(refundId.status).toBe('PENDING');
    await http()
      .patch(`/api/v1/admin/refunds/${refundId.id}`)
      .set(bearer(admin))
      .send({ status: 'APPROVED' })
      .expect(200);
    expect(await statusOf(order.id)).toBe('CANCELLED');
  });

  it('la conciliación resuelve pagos cuya notificación se perdió; el vencimiento los espera', async () => {
    const order = await placeOrder();
    const { reference } = await startPayment(order);
    // Llegó el evento PENDING (p. ej. PSE) y después nada.
    const transaction = t.wompi.transaction(reference, 'PENDING', order.totalCents);
    await webhook(t.wompi.event(transaction)).expect(200);

    await t.prisma.order.update({
      where: { id: order.id },
      data: { paymentDueAt: new Date(Date.now() - 1000) },
    });
    expect(await t.app.get(OrderExpiryJob).expire()).toBe(0);

    t.wompi.transaction(reference, 'APPROVED', order.totalCents, transaction.id);
    await t.prisma.payment.updateMany({ data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await t.app.get(PaymentsService).reconcile()).toBe(1);
    expect(await statusOf(order.id)).toBe('PAID');
  });

  it('exige permisos para ver pagos y reembolsar', async () => {
    const customer = await signIn(t, 'cliente@example.com');
    await http().get('/api/v1/admin/payments').set(bearer(customer.token)).expect(403);
  });
});
