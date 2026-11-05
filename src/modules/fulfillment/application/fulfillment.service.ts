import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../shared/application/actor';
import { AUDIT_TRAIL, type AuditTrail } from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { DOMAIN_EVENTS, type DomainEvents } from '../../../shared/application/domain-events';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import {
  CustomerOrders,
  OrderAdministration,
  OrderLifecycle,
} from '../../ordering/application/orders.services';
import type { OrderRecord } from '../../ordering/application/ports';
import { assertShipmentTransition, cleanText, type ShipmentStatus } from '../domain/shipment';

export interface TrackingEventRecord {
  status: ShipmentStatus;
  carrierStatus: string | null;
  description: string | null;
  occurredAt: Date;
}

export interface ShipmentRecord {
  id: string;
  orderId: string;
  status: ShipmentStatus;
  carrier: string | null;
  trackingNumber: string | null;
  shippingMethodName: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  events: TrackingEventRecord[];
  createdAt: Date;
}

export interface ShipmentRepository {
  create(shipment: {
    id: string;
    orderId: string;
    shippingMethodId: string | null;
    status: ShipmentStatus;
    carrier: string | null;
    trackingNumber: string | null;
    shippedAt: Date | null;
  }): Promise<void>;
  find(id: string): Promise<ShipmentRecord | null>;
  listForOrder(orderId: string): Promise<ShipmentRecord[]>;
  addEvent(shipmentId: string, event: TrackingEventRecord): Promise<void>;
  /** Cambia el estado solo si sigue en `from`. */
  updateStatus(
    id: string,
    from: ShipmentStatus,
    to: ShipmentStatus,
    dates: { shippedAt?: Date; deliveredAt?: Date },
  ): Promise<boolean>;
}
export const SHIPMENT_REPOSITORY = Symbol('ShipmentRepository');

export interface NewShipment {
  carrier: string;
  trackingNumber?: string | null | undefined;
  note?: string | null | undefined;
}

export interface NewTrackingEvent {
  status: ShipmentStatus;
  description?: string | null | undefined;
  carrierStatus?: string | null | undefined;
  occurredAt?: Date | undefined;
}

/**
 * Despachos y seguimiento. Las transportadoras no están integradas por API:
 * la guía y los eventos se registran desde la administración. Los estados del
 * envío mueven el pedido (PROCESSING → SHIPPED → DELIVERED).
 */
@Injectable()
export class FulfillmentService {
  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly shipments: ShipmentRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(DOMAIN_EVENTS) private readonly events: DomainEvents,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly lifecycle: OrderLifecycle,
    private readonly orders: OrderAdministration,
    private readonly customerOrders: CustomerOrders,
  ) {}

  listForOrder(orderId: string): Promise<ShipmentRecord[]> {
    return this.shipments.listForOrder(orderId);
  }

  /** Seguimiento para el cliente (con su sesión o el token del correo). */
  async trackingFor(orderNumber: string, userId: string | null, token: string | null) {
    const number = orderNumber.toUpperCase();
    let order: OrderRecord;
    if (userId) order = await this.customerOrders.getForUser(userId, number);
    else if (token) order = await this.customerOrders.getForGuest(number, token);
    else throw new NotFoundError('Pedido');
    return { order, shipments: await this.shipments.listForOrder(order.id) };
  }

  /** Registra el despacho. Con guía, el pedido queda SHIPPED. */
  createShipment(actor: Actor, orderId: string, input: NewShipment): Promise<ShipmentRecord> {
    return this.unitOfWork.execute(async () => {
      const order = await this.lifecycle.require(orderId);
      if (!['PAID', 'PROCESSING', 'SHIPPED'].includes(order.status)) {
        throw new BusinessRuleViolation(
          'Solo se despachan pedidos pagados',
          'ORDER_NOT_SHIPPABLE',
          { status: order.status },
        );
      }
      const carrier = cleanText(input.carrier, 80);
      if (!carrier) throw new BusinessRuleViolation('Indica la transportadora', 'CARRIER_REQUIRED');
      const trackingNumber = cleanText(input.trackingNumber, 80);
      const now = this.clock.now();
      const status: ShipmentStatus = trackingNumber ? 'IN_TRANSIT' : 'READY';
      const id = crypto.randomUUID();
      await this.shipments.create({
        id,
        orderId,
        shippingMethodId: order.shippingMethod?.id ?? null,
        status,
        carrier,
        trackingNumber,
        shippedAt: status === 'IN_TRANSIT' ? now : null,
      });
      await this.shipments.addEvent(id, {
        status,
        carrierStatus: null,
        description:
          cleanText(input.note, 300) ??
          (trackingNumber ? `Guía ${trackingNumber}` : 'Listo para despacho'),
        occurredAt: now,
      });
      await this.audit.record({
        actorId: actor.id,
        action: 'shipment.created',
        resource: 'Order',
        resourceId: orderId,
        metadata: { shipmentId: id, carrier, trackingNumber },
        ipAddress: actor.context.ipAddress,
      });
      await this.syncOrder(actor, order, status);
      this.events.publish({ type: 'shipment.updated', orderId, shipmentId: id, status });
      return (await this.shipments.find(id))!;
    });
  }

  addEvent(actor: Actor, shipmentId: string, input: NewTrackingEvent): Promise<ShipmentRecord> {
    return this.unitOfWork.execute(async () => {
      const shipment = await this.shipments.find(shipmentId);
      if (!shipment) throw new NotFoundError('Envío', shipmentId);
      assertShipmentTransition(shipment.status, input.status);
      const at = input.occurredAt ?? this.clock.now();
      if (at.getTime() > this.clock.now().getTime() + 60_000) {
        throw new BusinessRuleViolation(
          'La fecha del evento no puede ser futura',
          'INVALID_EVENT_DATE',
        );
      }
      await this.shipments.addEvent(shipmentId, {
        status: input.status,
        carrierStatus: cleanText(input.carrierStatus, 100),
        description: cleanText(input.description, 300),
        occurredAt: at,
      });
      if (input.status !== shipment.status) {
        await this.shipments.updateStatus(shipmentId, shipment.status, input.status, {
          ...(input.status === 'IN_TRANSIT' && !shipment.shippedAt ? { shippedAt: at } : {}),
          ...(input.status === 'DELIVERED' ? { deliveredAt: at } : {}),
        });
      }
      await this.syncOrder(actor, await this.lifecycle.require(shipment.orderId), input.status);
      this.events.publish({
        type: 'shipment.updated',
        orderId: shipment.orderId,
        shipmentId,
        status: input.status,
      });
      return (await this.shipments.find(shipmentId))!;
    });
  }

  /** Lleva el pedido al estado que corresponde al envío (sin saltarse pasos). */
  private async syncOrder(actor: Actor, order: OrderRecord, status: ShipmentStatus): Promise<void> {
    const target =
      status === 'DELIVERED' ? 'DELIVERED' : status === 'IN_TRANSIT' ? 'SHIPPED' : 'PROCESSING';
    const path = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] as const;
    const from = path.indexOf(order.status as (typeof path)[number]);
    const to = path.indexOf(target);
    if (from < 0) return;
    for (let step = from + 1; step <= to; step += 1) {
      await this.orders.changeStatus(
        actor,
        order.id,
        path[step]!,
        step === to ? 'Según el envío' : null,
      );
    }
  }
}
