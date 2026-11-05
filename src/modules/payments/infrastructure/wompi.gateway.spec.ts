import { createHash } from 'node:crypto';
import { assertRefundable, canMovePayment, statusAfterRefunds } from '../domain/payment';
import { WompiGateway, wompiEventChecksum, wompiIntegritySignature } from './wompi.gateway';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const config = {
  apiUrl: 'https://sandbox.wompi.co/v1',
  checkoutUrl: 'https://checkout.wompi.co/p/',
  publicKey: 'pub_test_123',
  privateKey: 'prv_test_123',
  eventsSecret: 'test_events_secret',
  integritySecret: 'test_integrity_secret',
};

/** Evento como el del ejemplo de docs.wompi.co/docs/colombia/eventos. */
const event = (overrides: Record<string, unknown> = {}) => ({
  event: 'transaction.updated',
  data: {
    transaction: {
      id: '1234-1610641025-49201',
      amount_in_cents: 4490000,
      reference: 'TCC-000001-ABCD1234',
      customer_email: 'ana@example.com',
      currency: 'COP',
      payment_method_type: 'NEQUI',
      status: 'APPROVED',
    },
  },
  environment: 'test',
  signature: {
    properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
    checksum: '',
  },
  timestamp: 1530291411,
  sent_at: '2018-07-20T16:45:05.000Z',
  ...overrides,
});

describe('firmas de Wompi', () => {
  it('integridad: referencia + centavos + moneda + [expiración] + secreto (docs, paso 3)', () => {
    expect(
      wompiIntegritySignature('sk8-438k4-xmxm392-sn2m2', 2490000, 'COP', null, 'secreto'),
    ).toBe(sha256('sk8-438k4-xmxm392-sn2m22490000COPsecreto'));
    expect(
      wompiIntegritySignature(
        'sk8-438k4-xmxm392-sn2m2',
        2490000,
        'COP',
        '2023-06-09T20:28:50.000Z',
        'prod_integrity_x',
      ),
    ).toBe(sha256('sk8-438k4-xmxm392-sn2m22490000COP2023-06-09T20:28:50.000Zprod_integrity_x'));
  });

  it('eventos: valores de properties + timestamp + secreto (ejemplo de la documentación)', () => {
    expect(wompiEventChecksum(event(), 'prod_events_x')).toBe(
      sha256('1234-1610641025-49201APPROVED44900001530291411prod_events_x'),
    );
  });

  it('lee properties del propio evento (pueden cambiar con el tiempo)', () => {
    const body = event({ signature: { properties: ['transaction.reference'], checksum: '' } });
    expect(wompiEventChecksum(body, 's')).toBe(sha256('TCC-000001-ABCD12341530291411s'));
  });

  it.each([null, 'texto', {}, { signature: { properties: ['transaction.id'] } }])(
    'no calcula checksum de cuerpos malformados: %p',
    (body) => {
      expect(wompiEventChecksum(body, 's')).toBeNull();
    },
  );
});

describe('WompiGateway', () => {
  const gateway = new WompiGateway(config, jest.fn());
  const signed = (body: ReturnType<typeof event>) => ({
    ...body,
    signature: {
      ...body.signature,
      checksum: wompiEventChecksum(body, config.eventsSecret)!.toUpperCase(),
    },
  });

  it('arma el Web Checkout con la firma y los datos del cliente', () => {
    const session = gateway.createCheckout({
      reference: 'TCC-000001-AB',
      amountCents: 24990000,
      currency: 'COP',
      expiresAt: new Date('2026-11-05T20:00:00.000Z'),
      redirectUrl: 'https://tienda.co/pedido/TCC-000001/pago',
      customer: {
        email: 'ana@example.com',
        fullName: 'Ana Pérez',
        phone: '+573001234567',
        legalIdType: 'CC',
        legalId: '1020304050',
      },
    });
    const url = new URL(session.checkoutUrl);
    expect(url.origin + url.pathname).toBe('https://checkout.wompi.co/p/');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      'public-key': 'pub_test_123',
      currency: 'COP',
      'amount-in-cents': '24990000',
      reference: 'TCC-000001-AB',
      'expiration-time': '2026-11-05T20:00:00.000Z',
      'signature:integrity': wompiIntegritySignature(
        'TCC-000001-AB',
        24990000,
        'COP',
        '2026-11-05T20:00:00.000Z',
        config.integritySecret,
      ),
      'customer-data:phone-number': '3001234567',
      'customer-data:phone-number-prefix': '+57',
      'customer-data:legal-id-type': 'CC',
    });
    expect(session.widget).toMatchObject({ amountInCents: 24990000, reference: 'TCC-000001-AB' });
  });

  it('acepta el checksum en el cuerpo o en X-Event-Checksum, sin importar mayúsculas', () => {
    const body = signed(event());
    const parsed = gateway.parseEvent(body, {});
    expect(parsed).toMatchObject({
      signatureValid: true,
      eventType: 'transaction.updated',
      transaction: { id: '1234-1610641025-49201', status: 'APPROVED', amountCents: 4490000 },
    });
    const unsigned = event();
    expect(
      gateway.parseEvent(unsigned, {
        'x-event-checksum': wompiEventChecksum(unsigned, config.eventsSecret)!,
      }).signatureValid,
    ).toBe(true);
  });

  it('rechaza eventos alterados o firmados con otro secreto', () => {
    const body = signed(event());
    body.data.transaction.amount_in_cents = 100;
    expect(gateway.parseEvent(body, {}).signatureValid).toBe(false);
    const other = {
      ...event(),
      signature: { ...event().signature, checksum: wompiEventChecksum(event(), 'otro')! },
    };
    expect(gateway.parseEvent(other, {}).signatureValid).toBe(false);
    expect(gateway.parseEvent('basura', {}).signatureValid).toBe(false);
  });

  it('consulta transacciones con la llave privada', async () => {
    const http = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: event().data.transaction }), { status: 200 }),
      );
    const transaction = await new WompiGateway(config, http).fetchTransaction('1234');
    expect(transaction).toMatchObject({ reference: 'TCC-000001-ABCD1234', status: 'APPROVED' });
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://sandbox.wompi.co/v1/transactions/1234');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer prv_test_123');
  });

  it('una caída de la pasarela responde 503', async () => {
    const http = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockRejectedValue(new Error('timeout'));
    await expect(new WompiGateway(config, http).fetchTransaction('1')).rejects.toMatchObject({
      code: 'PAYMENT_GATEWAY_UNAVAILABLE',
    });
  });

  it('pide reembolsos parciales con monto en centavos', async () => {
    const http = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 991, status: 'APPROVED' } }), { status: 201 }),
      );
    const refund = await new WompiGateway(config, http).refund({
      transactionId: 't1',
      amountCents: 1000000,
      reason: 'Retracto',
      reference: 'r1',
    });
    expect(refund).toEqual({ providerReference: '991', status: 'APPROVED', failureReason: null });
    expect(JSON.parse(http.mock.calls[0]![1]!.body as string)).toEqual({
      transaction_id: 't1',
      amount_in_cents: 1000000,
      reason: 'Retracto',
      reference: 'r1',
    });
  });
});

describe('reglas del pago', () => {
  it('solo avanza: las notificaciones desordenadas no retroceden el estado', () => {
    expect(canMovePayment('PENDING', 'APPROVED')).toBe(true);
    expect(canMovePayment('APPROVED', 'PENDING')).toBe(false);
    expect(canMovePayment('DECLINED', 'APPROVED')).toBe(false);
  });

  it('no reembolsa más de lo pagado', () => {
    const payment = { status: 'APPROVED' as const, amountCents: 10_000 };
    expect(() => assertRefundable(payment, 4_000, 6_000)).not.toThrow();
    expect(() => assertRefundable(payment, 4_000, 6_001)).toThrow(/supera/);
    expect(() => assertRefundable({ ...payment, status: 'PENDING' }, 0, 1)).toThrow(/aprobados/);
    expect(statusAfterRefunds(10_000, 4_000)).toBe('PARTIALLY_REFUNDED');
    expect(statusAfterRefunds(10_000, 10_000)).toBe('REFUNDED');
  });
});
