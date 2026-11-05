/**
 * Hechos del negocio que interesan a otros módulos (notificaciones, alertas).
 * Se publican dentro de los casos de uso y se entregan solo si la transacción
 * se confirma; quien los recibe nunca puede deshacer la operación.
 */
export type DomainEvent =
  | {
      type: 'order.placed';
      orderId: string;
      /** Solo invitados: para el enlace del correo. */ accessToken: string | null;
    }
  | { type: 'order.paid'; orderId: string }
  | { type: 'order.status_changed'; orderId: string; from: string; to: string; note: string | null }
  | { type: 'shipment.updated'; orderId: string; shipmentId: string; status: string }
  | { type: 'payment.needs_review'; paymentId: string; reason: string; orderNumber: string }
  | { type: 'stock.low'; variantId: string; available: number }
  | { type: 'job.failed'; job: string; error: string };

export type DomainEventType = DomainEvent['type'];
export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
export type EventHandler<T extends DomainEventType> = (event: EventOf<T>) => Promise<void> | void;

export interface DomainEvents {
  /** Se entrega al confirmarse la transacción en curso (o de inmediato si no hay). */
  publish(event: DomainEvent): void;
  subscribe<T extends DomainEventType>(type: T, handler: EventHandler<T>): void;
}

export const DOMAIN_EVENTS = Symbol('DomainEvents');
