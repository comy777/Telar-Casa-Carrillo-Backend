import type { Page, PageRequest } from '../../../shared/application/audit-trail';
import type { IdentityDocumentType } from '../../../shared/domain/colombia';
import type { PostalAddress } from '../../shipping/domain/address';
import type { OrderStatus } from '../domain/order-status';

export interface OrderCustomer {
  email: string;
  name: string;
  phone: string | null;
  documentType: IdentityDocumentType | null;
  documentNumber: string | null;
}

export interface OrderItemRecord {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
  /** Con descuento, IVA incluido. */
  lineTotalCents: number;
  taxRateBasisPoints: number;
  taxCents: number;
  snapshot: Record<string, unknown>;
}

export interface OrderHistoryRecord {
  from: OrderStatus | null;
  to: OrderStatus;
  actorId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  userId: string | null;
  status: OrderStatus;
  currency: string;
  subtotalCents: number;
  discountTotalCents: number;
  shippingTotalCents: number;
  taxTotalCents: number;
  grandTotalCents: number;
  customer: OrderCustomer;
  shippingAddress: PostalAddress;
  billingAddress: PostalAddress | null;
  shippingMethod: { id: string; name: string } | null;
  couponCode: string | null;
  notes: string | null;
  guestAccessTokenHash: string | null;
  paymentDueAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  invoice: { number: string; cufe: string | null; issuedAt: Date | null } | null;
  items: OrderItemRecord[];
  history: OrderHistoryRecord[];
  createdAt: Date;
}

export type NewOrder = Omit<
  OrderRecord,
  'status' | 'paidAt' | 'cancelledAt' | 'invoice' | 'history' | 'couponCode' | 'shippingMethod'
> & {
  couponId: string | null;
  shippingMethodId: string;
  termsAcceptedAt: Date;
  privacyPolicyVersion: string;
};

export interface OrderListQuery extends PageRequest {
  status?: OrderStatus | undefined;
  /** Número de pedido, correo o nombre. */
  search?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** Pagados sin factura registrada. */
  invoicePending?: boolean | undefined;
}

export interface TransitionChange {
  from: OrderStatus;
  to: OrderStatus;
  actorId: string | null;
  note?: string | null | undefined;
  at: Date;
}

export interface OrderRepository {
  nextSequence(): Promise<number>;
  create(order: NewOrder): Promise<void>;
  findById(id: string): Promise<OrderRecord | null>;
  findByNumber(orderNumber: string): Promise<OrderRecord | null>;
  listForUser(userId: string, page: PageRequest): Promise<Page<OrderRecord>>;
  list(query: OrderListQuery): Promise<Page<OrderRecord>>;
  /**
   * Cambia el estado solo si sigue siendo `from` (dos procesos no pueden
   * aplicar la misma transición) y deja la fila en el historial.
   */
  transition(id: string, change: TransitionChange): Promise<boolean>;
  findOverdueUnpaid(now: Date, limit: number): Promise<string[]>;
  /** Lanza ConflictError si el número o el CUFE ya están en otro pedido. */
  setInvoice(
    id: string,
    invoice: { number: string; cufe: string | null; issuedAt: Date },
  ): Promise<void>;
}
export const ORDER_REPOSITORY = Symbol('OrderRepository');

/** Tokens para que un invitado consulte su pedido (solo se guarda el hash). */
export interface OrderAccessTokens {
  generate(): { token: string; hash: string };
  matches(token: string, hash: string): boolean;
}
export const ORDER_ACCESS_TOKENS = Symbol('OrderAccessTokens');

export interface IssuedInvoice {
  number: string;
  cufe: string;
  issuedAt: Date;
}

/**
 * Facturación electrónica DIAN a través de un proveedor tecnológico. Devuelve
 * null si la factura queda para emitirse manualmente (sin proveedor configurado).
 */
export interface ElectronicInvoiceIssuer {
  issue(order: OrderRecord): Promise<IssuedInvoice | null>;
}
export const ELECTRONIC_INVOICE_ISSUER = Symbol('ElectronicInvoiceIssuer');

export interface OrderingSettings {
  paymentMinutes: number;
  orderNumberPrefix: string;
  shippingTaxBasisPoints: number;
  storefrontUrl: string;
  privacyPolicyVersion: string;
}
export const ORDERING_SETTINGS = Symbol('OrderingSettings');
