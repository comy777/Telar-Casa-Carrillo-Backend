import {
  WompiGateway,
  wompiEventChecksum,
} from '../../src/modules/payments/infrastructure/wompi.gateway';

export const WOMPI_TEST_CONFIG = {
  apiUrl: 'https://sandbox.wompi.co/v1',
  checkoutUrl: 'https://checkout.wompi.co/p/',
  publicKey: 'pub_test_e2e',
  privateKey: 'prv_test_e2e',
  eventsSecret: 'test_events_e2e',
  integritySecret: 'test_integrity_e2e',
};

export interface FakeTransaction {
  id: string;
  reference: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';
  amount_in_cents: number;
  currency?: string;
  payment_method_type?: string;
}

/**
 * API de Wompi en memoria: el adaptador real (firmas incluidas) habla con esta
 * en lugar de la red. Permite simular transacciones, eventos y reembolsos.
 */
export class FakeWompi {
  readonly transactions = new Map<string, FakeTransaction>();
  refundStatus: 'APPROVED' | 'PENDING' | 'DECLINED' = 'APPROVED';
  readonly refundRequests: unknown[] = [];
  private sequence = 0;

  readonly gateway = new WompiGateway(WOMPI_TEST_CONFIG, (input, init) => this.fetch(input, init));

  /** Crea o actualiza la transacción que la "pasarela" reporta para una referencia. */
  transaction(
    reference: string,
    status: FakeTransaction['status'],
    amountCents: number,
    id?: string,
  ) {
    const existing = [...this.transactions.values()].find(
      (t) => t.reference === reference && (!id || t.id === id),
    );
    const transaction: FakeTransaction = {
      id: id ?? existing?.id ?? `${++this.sequence}-1730000000-${this.sequence}`,
      reference,
      status,
      amount_in_cents: amountCents,
      currency: 'COP',
      payment_method_type: 'CARD',
    };
    this.transactions.set(transaction.id, transaction);
    return transaction;
  }

  /** Evento transaction.updated firmado con el secreto de eventos (o con otro). */
  event(
    transaction: FakeTransaction,
    secret = WOMPI_TEST_CONFIG.eventsSecret,
    timestamp = Date.now(),
  ) {
    const body = {
      event: 'transaction.updated',
      data: { transaction: { ...transaction, customer_email: 'ana@example.com' } },
      environment: 'test',
      signature: {
        properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
        checksum: '',
      },
      timestamp: Math.floor(timestamp / 1000),
      sent_at: new Date(timestamp).toISOString(),
    };
    body.signature.checksum = wompiEventChecksum(body, secret)!;
    return body;
  }

  clear(): void {
    this.transactions.clear();
    this.refundRequests.length = 0;
    this.refundStatus = 'APPROVED';
  }

  private fetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    if (auth !== `Bearer ${WOMPI_TEST_CONFIG.privateKey}`) {
      return Promise.resolve(new Response('{}', { status: 404 }));
    }
    const transactionMatch = url.pathname.match(/^\/v1\/transactions\/(.+)$/);
    if (init?.method === 'GET' && transactionMatch) {
      const transaction = this.transactions.get(decodeURIComponent(transactionMatch[1]!));
      return Promise.resolve(
        transaction
          ? new Response(JSON.stringify({ data: transaction }), { status: 200 })
          : new Response(JSON.stringify({ error: { type: 'NOT_FOUND_ERROR' } }), { status: 404 }),
      );
    }
    if (init?.method === 'POST' && url.pathname === '/v1/refunds') {
      this.refundRequests.push(JSON.parse(init.body as string));
      return Promise.resolve(
        new Response(JSON.stringify({ data: { id: ++this.sequence, status: this.refundStatus } }), {
          status: 201,
        }),
      );
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  }
}
