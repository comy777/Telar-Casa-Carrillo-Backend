import { createHash, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableError } from '../../../shared/domain/errors';
import type {
  CheckoutRequest,
  CheckoutSession,
  GatewayRefund,
  GatewayTransaction,
  ParsedEvent,
  PaymentGateway,
} from '../application/ports';
import type { GatewayStatus } from '../domain/payment';

export interface WompiConfig {
  apiUrl: string;
  checkoutUrl: string;
  publicKey: string;
  privateKey: string;
  eventsSecret: string;
  integritySecret: string;
}

type Fetch = typeof fetch;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Firma de integridad del checkout (docs.wompi.co, Widget & Checkout Web, paso 3):
 * SHA-256 de "<referencia><monto en centavos><moneda>[<fecha de expiración>]<secreto>".
 */
export function wompiIntegritySignature(
  reference: string,
  amountInCents: number,
  currency: string,
  expirationTime: string | null,
  integritySecret: string,
): string {
  return sha256(`${reference}${amountInCents}${currency}${expirationTime ?? ''}${integritySecret}`);
}

/** Valor en `data` de una ruta como "transaction.id". */
function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      data,
    );
}

/**
 * Checksum de eventos (docs.wompi.co, Eventos): SHA-256 de los valores de
 * `signature.properties` (en ese orden, leídos de `data`) + `timestamp` + secreto
 * de eventos. Devuelve null si el cuerpo no tiene la forma esperada.
 */
export function wompiEventChecksum(body: unknown, eventsSecret: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const event = body as Record<string, unknown>;
  const signature = event['signature'] as { properties?: unknown } | undefined;
  const properties = signature?.properties;
  if (!Array.isArray(properties) || properties.length === 0) return null;
  if (typeof event['timestamp'] !== 'number' && typeof event['timestamp'] !== 'string') return null;
  const values = properties.map((property) =>
    typeof property === 'string' ? valueAt(event['data'], property) : undefined,
  );
  if (values.some((value) => value === undefined || value === null || typeof value === 'object')) {
    return null;
  }
  return sha256(`${values.map(String).join('')}${String(event['timestamp'])}${eventsSecret}`);
}

const STATUSES: readonly GatewayStatus[] = ['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'];

function toTransaction(raw: unknown): GatewayTransaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const status = String(t['status']);
  if (
    typeof t['id'] !== 'string' ||
    typeof t['reference'] !== 'string' ||
    typeof t['amount_in_cents'] !== 'number' ||
    !STATUSES.includes(status as GatewayStatus)
  ) {
    return null;
  }
  return {
    id: t['id'],
    reference: t['reference'],
    status: status as GatewayStatus,
    amountCents: t['amount_in_cents'],
    currency: typeof t['currency'] === 'string' ? t['currency'] : 'COP',
    paymentMethodType:
      typeof t['payment_method_type'] === 'string' ? t['payment_method_type'] : null,
  };
}

const sameHex = (a: string, b: string): boolean => {
  const left = Buffer.from(a.toLowerCase(), 'utf8');
  const right = Buffer.from(b.toLowerCase(), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Wompi (Colombia) por su API REST; sin SDK. */
export class WompiGateway implements PaymentGateway {
  readonly provider = 'wompi';

  constructor(
    private readonly config: WompiConfig,
    private readonly http: Fetch = fetch,
  ) {}

  createCheckout(request: CheckoutRequest): CheckoutSession {
    const expirationTime = request.expiresAt ? request.expiresAt.toISOString() : null;
    const integrity = wompiIntegritySignature(
      request.reference,
      request.amountCents,
      request.currency,
      expirationTime,
      this.config.integritySecret,
    );
    const params = new URLSearchParams({
      'public-key': this.config.publicKey,
      currency: request.currency,
      'amount-in-cents': String(request.amountCents),
      reference: request.reference,
      'signature:integrity': integrity,
      'redirect-url': request.redirectUrl,
      'customer-data:email': request.customer.email,
      'customer-data:full-name': request.customer.fullName,
    });
    if (expirationTime) params.set('expiration-time', expirationTime);
    const phone = request.customer.phone?.replace(/^\+?57/, '');
    if (phone) {
      params.set('customer-data:phone-number', phone);
      params.set('customer-data:phone-number-prefix', '+57');
    }
    if (request.customer.legalId && request.customer.legalIdType) {
      params.set('customer-data:legal-id', request.customer.legalId);
      params.set('customer-data:legal-id-type', request.customer.legalIdType);
    }
    return {
      provider: this.provider,
      checkoutUrl: `${this.config.checkoutUrl}?${params.toString()}`,
      widget: {
        publicKey: this.config.publicKey,
        currency: request.currency,
        amountInCents: request.amountCents,
        reference: request.reference,
        signature: { integrity },
        redirectUrl: request.redirectUrl,
        expirationTime,
      },
    };
  }

  parseEvent(body: unknown, headers: Record<string, string | undefined>): ParsedEvent {
    const event = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const expected = wompiEventChecksum(body, this.config.eventsSecret);
    const signature = event['signature'] as { checksum?: unknown } | undefined;
    const received =
      headers['x-event-checksum'] ??
      (typeof signature?.checksum === 'string' ? signature.checksum : undefined);
    const signatureValid = Boolean(expected && received && sameHex(expected, received));
    const data = event['data'] as Record<string, unknown> | undefined;
    const eventType = typeof event['event'] === 'string' ? event['event'] : 'unknown';
    return {
      // El checksum identifica el evento (contenido + timestamp): un reenvío trae el mismo.
      eventId: (received ?? expected ?? sha256(JSON.stringify(body ?? null))).toLowerCase(),
      eventType,
      signatureValid,
      transaction:
        eventType === 'transaction.updated' ? toTransaction(data?.['transaction']) : null,
    };
  }

  async fetchTransaction(transactionId: string): Promise<GatewayTransaction | null> {
    const response = await this.call('GET', `/transactions/${encodeURIComponent(transactionId)}`);
    if (response.status === 404) return null;
    return toTransaction((await this.json(response))['data']);
  }

  async refund(request: {
    transactionId: string;
    amountCents: number;
    reason: string;
    reference: string;
  }): Promise<GatewayRefund> {
    const response = await this.call('POST', '/refunds', {
      transaction_id: request.transactionId,
      amount_in_cents: request.amountCents,
      reason: request.reason,
      reference: request.reference,
    });
    const body = await this.json(response);
    if (!response.ok) {
      const error = body['error'] as { reason?: unknown; messages?: unknown } | undefined;
      return {
        providerReference: null,
        status: 'FAILED',
        failureReason: `Wompi respondió ${response.status}: ${JSON.stringify(error ?? body).slice(0, 400)}`,
      };
    }
    const data = (body['data'] ?? {}) as Record<string, unknown>;
    const status = typeof data['status'] === 'string' ? data['status'].toUpperCase() : 'PENDING';
    const id = data['id'];
    return {
      providerReference: typeof id === 'string' || typeof id === 'number' ? String(id) : null,
      // Mientras la pasarela no confirme, el reembolso queda en curso.
      status:
        status === 'APPROVED'
          ? 'APPROVED'
          : ['DECLINED', 'ERROR', 'CANCELLED', 'FAILED'].includes(status)
            ? 'FAILED'
            : 'PENDING',
      failureReason: null,
    };
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    try {
      return await this.http(`${this.config.apiUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.privateKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ServiceUnavailableError(
        'La pasarela de pagos no respondió',
        'PAYMENT_GATEWAY_UNAVAILABLE',
      );
    }
  }

  private async json(response: Response): Promise<Record<string, unknown>> {
    if (response.status >= 500) {
      throw new ServiceUnavailableError(
        'La pasarela de pagos no respondió',
        'PAYMENT_GATEWAY_UNAVAILABLE',
      );
    }
    return ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  }
}

/** Sin llaves configuradas (solo fuera de producción): los pagos responden 503. */
export class DisabledPaymentGateway implements PaymentGateway {
  readonly provider = 'wompi';

  private unavailable(): never {
    throw new ServiceUnavailableError(
      'Los pagos no están configurados (faltan las llaves de Wompi)',
      'PAYMENTS_NOT_CONFIGURED',
    );
  }

  createCheckout(): CheckoutSession {
    return this.unavailable();
  }

  parseEvent(): ParsedEvent {
    return this.unavailable();
  }

  fetchTransaction(): Promise<GatewayTransaction | null> {
    return this.unavailable();
  }

  refund(): Promise<GatewayRefund> {
    return this.unavailable();
  }
}
