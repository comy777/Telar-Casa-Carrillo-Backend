import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  DOMAIN_EVENTS,
  type DomainEvents,
  type EventOf,
} from '../../../shared/application/domain-events';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/application/email-sender';
import { centsToPesos } from '../../catalog/domain/money';
import { FulfillmentService } from '../../fulfillment/application/fulfillment.service';
import { OrderLifecycle } from '../../ordering/application/orders.services';
import type { OrderRecord } from '../../ordering/application/ports';

export interface NotificationSettings {
  storefrontUrl: string;
  adminUrl: string;
  adminEmails: string[];
}
export const NOTIFICATION_SETTINGS = Symbol('NotificationSettings');

const money = (cents: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(
    centsToPesos(cents),
  );

const SIGNATURE = ['', 'Telar Casa Carrillo'];

/**
 * Correos al cliente según el ciclo del pedido y alertas a la tienda. Corre
 * después del commit: un fallo al enviar se registra y no afecta al pedido.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DOMAIN_EVENTS) private readonly events: DomainEvents,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(NOTIFICATION_SETTINGS) private readonly settings: NotificationSettings,
    private readonly orders: OrderLifecycle,
    private readonly fulfillment: FulfillmentService,
  ) {}

  onModuleInit(): void {
    this.events.subscribe('order.placed', (event) => this.orderPlaced(event));
    this.events.subscribe('order.paid', (event) => this.orderPaid(event));
    this.events.subscribe('order.status_changed', (event) => this.statusChanged(event));
    this.events.subscribe('payment.needs_review', (event) =>
      this.alert(`Pago por revisar: pedido ${event.orderNumber}`, [
        `El pago del pedido ${event.orderNumber} necesita revisión (${event.reason}).`,
        'Normalmente hay que reembolsarlo.',
        '',
        `${this.settings.adminUrl}/pagos?revision=1`,
      ]),
    );
    this.events.subscribe('stock.low', (event) =>
      this.alert('Pocas unidades disponibles', [
        `Una variante quedó con ${event.available} unidades disponibles.`,
        `${this.settings.adminUrl}/inventario?variante=${event.variantId}`,
      ]),
    );
    this.events.subscribe('job.failed', (event) =>
      this.alert(`Falló el proceso ${event.job}`, [
        `El proceso programado ${event.job} falló: ${event.error}`,
        'Revisa los logs de la API.',
      ]),
    );
  }

  private link(order: OrderRecord, token?: string | null): string {
    if (order.userId) return `${this.settings.storefrontUrl}/cuenta/pedidos/${order.orderNumber}`;
    return `${this.settings.storefrontUrl}/pedido/${order.orderNumber}${token ? `?token=${token}` : ''}`;
  }

  private async orderPlaced(event: EventOf<'order.placed'>): Promise<void> {
    const order = await this.orders.require(event.orderId);
    await this.toCustomer(order, `Recibimos tu pedido ${order.orderNumber}`, [
      `Recibimos tu pedido ${order.orderNumber} por ${money(order.grandTotalCents)}.`,
      'Lo prepararemos en cuanto se confirme el pago.',
      '',
      `Consulta su estado aquí: ${this.link(order, event.accessToken)}`,
      ...(event.accessToken ? ['Guarda este correo: el enlace es tu acceso al pedido.'] : []),
    ]);
  }

  private async orderPaid(event: EventOf<'order.paid'>): Promise<void> {
    const order = await this.orders.require(event.orderId);
    await this.toCustomer(order, `Confirmamos el pago de tu pedido ${order.orderNumber}`, [
      `Recibimos el pago de ${money(order.grandTotalCents)}. Ya estamos preparando tu pedido.`,
      ...order.items.map(
        (item) =>
          `- ${item.quantity} × ${item.productName}${item.variantName ? ` (${item.variantName})` : ''}`,
      ),
      '',
      `Seguimiento: ${this.link(order)}`,
    ]);
    await this.alert(`Nuevo pedido pagado: ${order.orderNumber}`, [
      `${order.customer.name} pagó ${money(order.grandTotalCents)}.`,
      `Envío a ${order.shippingAddress.city}, ${order.shippingAddress.department}.`,
      `${this.settings.adminUrl}/pedidos/${order.id}`,
    ]);
  }

  private async statusChanged(event: EventOf<'order.status_changed'>): Promise<void> {
    const order = await this.orders.require(event.orderId);
    switch (event.to) {
      case 'SHIPPED': {
        const shipments = await this.fulfillment.listForOrder(order.id);
        const tracking = shipments
          .filter((s) => s.trackingNumber)
          .map((s) => `- ${s.carrier ?? 'Transportadora'}: guía ${s.trackingNumber}`);
        await this.toCustomer(order, `Tu pedido ${order.orderNumber} va en camino`, [
          'Despachamos tu pedido.',
          ...tracking,
          '',
          `Seguimiento: ${this.link(order)}`,
        ]);
        return;
      }
      case 'DELIVERED':
        await this.toCustomer(order, `Tu pedido ${order.orderNumber} fue entregado`, [
          'Esperamos que disfrutes estas piezas hechas a mano.',
          'Si algo no está bien o quieres devolverlo, responde a este correo.',
        ]);
        return;
      case 'CANCELLED':
        await this.toCustomer(order, `Tu pedido ${order.orderNumber} fue cancelado`, [
          event.from === 'PENDING_PAYMENT'
            ? 'No recibimos el pago a tiempo, así que liberamos los productos. Puedes hacer un pedido nuevo cuando quieras.'
            : 'Cancelamos el pedido y procesamos la devolución del dinero.',
          ...(event.note ? ['', `Detalle: ${event.note}`] : []),
        ]);
        return;
      case 'REFUNDED':
        await this.toCustomer(order, `Devolución del pedido ${order.orderNumber}`, [
          'Procesamos la devolución del dinero de tu pedido.',
          'El tiempo en que se ve reflejada depende de tu banco o medio de pago.',
        ]);
        return;
      default:
        return;
    }
  }

  private async toCustomer(order: OrderRecord, subject: string, lines: string[]): Promise<void> {
    await this.send(order.customer.email, subject, [
      `Hola ${order.customer.name},`,
      '',
      ...lines,
      ...SIGNATURE,
    ]);
  }

  private async alert(subject: string, lines: string[]): Promise<void> {
    if (this.settings.adminEmails.length === 0) {
      this.logger.warn(`Alerta sin destinatarios (ADMIN_ALERT_EMAILS vacío): ${subject}`);
      return;
    }
    for (const to of this.settings.adminEmails) {
      await this.send(to, `[Tienda] ${subject}`, lines);
    }
  }

  private async send(to: string, subject: string, lines: string[]): Promise<void> {
    try {
      await this.email.send({ to, subject, text: lines.join('\n') });
    } catch (error) {
      this.logger.error(
        `No se pudo enviar "${subject}" a ${to}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
