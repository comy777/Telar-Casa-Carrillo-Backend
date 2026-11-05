import type { Page, PageRequest } from '../../../shared/application/audit-trail';
import type { GatewayStatus, PaymentStatus, RefundStatus, ReviewReason } from '../domain/payment';

// ---------- Pasarela ----------

export interface GatewayTransaction {
  /** Id de la transacción en la pasarela. */
  id: string;
  /** Nuestra referencia (Payment.idempotencyKey). */
  reference: string;
  status: GatewayStatus;
  amountCents: number;
  currency: string;
  paymentMethodType: string | null;
}

export interface CheckoutRequest {
  reference: string;
  amountCents: number;
  currency: 'COP';
  expiresAt: Date | null;
  redirectUrl: string;
  customer: {
    email: string;
    fullName: string;
    phone: string | null;
    legalIdType: string | null;
    legalId: string | null;
  };
}

/** Lo que el frontend necesita para abrir el Web Checkout o el Widget. */
export interface CheckoutSession {
  provider: string;
  /** URL completa del Web Checkout (redirección). */
  checkoutUrl: string;
  /** Parámetros para el Widget de Wompi. */
  widget: {
    publicKey: string;
    currency: string;
    amountInCents: number;
    reference: string;
    signature: { integrity: string };
    redirectUrl: string;
    expirationTime: string | null;
  };
}

export interface ParsedEvent {
  /** Id estable del evento para no procesarlo dos veces. */
  eventId: string;
  eventType: string;
  signatureValid: boolean;
  /** Solo en eventos de transacción. */
  transaction: GatewayTransaction | null;
}

export interface GatewayRefund {
  providerReference: string | null;
  status: RefundStatus;
  failureReason: string | null;
}

export interface PaymentGateway {
  readonly provider: string;
  createCheckout(request: CheckoutRequest): CheckoutSession;
  /** Verifica la firma con el secreto de eventos; nunca lanza por datos malformados. */
  parseEvent(body: unknown, headers: Record<string, string | undefined>): ParsedEvent;
  /** Consulta la transacción con la llave privada (fuente de verdad). */
  fetchTransaction(transactionId: string): Promise<GatewayTransaction | null>;
  refund(request: {
    transactionId: string;
    amountCents: number;
    reason: string;
    reference: string;
  }): Promise<GatewayRefund>;
}
export const PAYMENT_GATEWAY = Symbol('PaymentGateway');

// ---------- Persistencia ----------

export interface PaymentRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  provider: string;
  providerReference: string | null;
  reference: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  paymentMethodType: string | null;
  reviewReason: ReviewReason | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefundRecord {
  id: string;
  paymentId: string;
  providerReference: string | null;
  status: RefundStatus;
  amountCents: number;
  reason: string | null;
  failureReason: string | null;
  idempotencyKey: string;
  requestedById: string | null;
  createdAt: Date;
}

export interface PaymentListQuery extends PageRequest {
  status?: PaymentStatus | undefined;
  needsReview?: boolean | undefined;
  orderNumber?: string | undefined;
}

export interface PaymentRepository {
  create(payment: {
    id: string;
    orderId: string;
    provider: string;
    reference: string;
    amountCents: number;
    currency: string;
  }): Promise<void>;
  findById(id: string): Promise<PaymentRecord | null>;
  findByReference(reference: string): Promise<PaymentRecord | null>;
  listForOrder(orderId: string): Promise<PaymentRecord[]>;
  list(query: PaymentListQuery): Promise<Page<PaymentRecord>>;
  /** Cambia el estado solo si sigue en `from`. */
  transition(id: string, from: PaymentStatus, to: PaymentStatus): Promise<boolean>;
  attachTransaction(
    id: string,
    providerReference: string,
    paymentMethodType: string | null,
  ): Promise<void>;
  flagForReview(id: string, reason: ReviewReason): Promise<void>;
  /** Pagos PENDING con transacción en la pasarela, para conciliar. */
  pendingWithTransaction(updatedBefore: Date, limit: number): Promise<PaymentRecord[]>;
  /** El pedido tiene un pago iniciado en la pasarela que aún no termina. */
  hasPendingTransaction(orderId: string, since: Date): Promise<boolean>;
  /** Registra el cambio reportado (idempotente por evento). */
  recordTransaction(entry: {
    paymentId: string;
    provider: string;
    providerEventId: string;
    eventType: string;
    status: GatewayStatus;
    payload: unknown;
  }): Promise<void>;
}
export const PAYMENT_REPOSITORY = Symbol('PaymentRepository');

export interface RefundRepository {
  findByIdempotencyKey(key: string): Promise<RefundRecord | null>;
  findById(id: string): Promise<RefundRecord | null>;
  listForPayment(paymentId: string): Promise<RefundRecord[]>;
  /** Reembolsos aprobados y en curso (para no devolver más de lo pagado). */
  committedCents(paymentId: string): Promise<number>;
  approvedCents(paymentId: string): Promise<number>;
  create(
    refund: Omit<RefundRecord, 'createdAt' | 'status' | 'providerReference' | 'failureReason'>,
  ): Promise<void>;
  /** Solo si sigue PENDING. */
  resolve(
    id: string,
    result: {
      status: RefundStatus;
      providerReference: string | null;
      failureReason: string | null;
    },
  ): Promise<boolean>;
}
export const REFUND_REPOSITORY = Symbol('RefundRepository');

export interface StoredWebhook {
  id: string;
  processed: boolean;
}

export interface WebhookEventRepository {
  /** Guarda la notificación (o devuelve la ya guardada con el mismo id de evento). */
  store(event: {
    provider: string;
    providerEventId: string;
    eventType: string;
    signatureValid: boolean;
    payload: unknown;
  }): Promise<StoredWebhook>;
  markProcessed(id: string, paymentId: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
export const WEBHOOK_EVENT_REPOSITORY = Symbol('WebhookEventRepository');

export interface PaymentSettings {
  storefrontUrl: string;
}
export const PAYMENT_SETTINGS = Symbol('PaymentSettings');
