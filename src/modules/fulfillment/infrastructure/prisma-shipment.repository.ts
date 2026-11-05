import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type {
  ShipmentRecord,
  ShipmentRepository,
  TrackingEventRecord,
} from '../application/fulfillment.service';
import type { ShipmentStatus } from '../domain/shipment';

const include = {
  shippingMethod: { select: { name: true } },
  events: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.ShipmentInclude;

type Row = Prisma.ShipmentGetPayload<{ include: typeof include }>;

const toRecord = (row: Row): ShipmentRecord => ({
  id: row.id,
  orderId: row.orderId,
  status: row.status,
  carrier: row.carrier,
  trackingNumber: row.trackingNumber,
  shippingMethodName: row.shippingMethod?.name ?? null,
  shippedAt: row.shippedAt,
  deliveredAt: row.deliveredAt,
  events: row.events.map((event) => ({
    status: event.status,
    carrierStatus: event.carrierStatus,
    description: event.description,
    occurredAt: event.occurredAt,
  })),
  createdAt: row.createdAt,
});

@Injectable()
export class PrismaShipmentRepository implements ShipmentRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async create(shipment: {
    id: string;
    orderId: string;
    shippingMethodId: string | null;
    status: ShipmentStatus;
    carrier: string | null;
    trackingNumber: string | null;
    shippedAt: Date | null;
  }): Promise<void> {
    await this.db.client.shipment.create({ data: shipment });
  }

  async find(id: string): Promise<ShipmentRecord | null> {
    const row = await this.db.client.shipment.findUnique({ where: { id }, include });
    return row ? toRecord(row) : null;
  }

  async listForOrder(orderId: string): Promise<ShipmentRecord[]> {
    const rows = await this.db.client.shipment.findMany({
      where: { orderId },
      include,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async addEvent(shipmentId: string, event: TrackingEventRecord): Promise<void> {
    await this.db.client.shippingTrackingEvent.create({ data: { shipmentId, ...event } });
  }

  async updateStatus(
    id: string,
    from: ShipmentStatus,
    to: ShipmentStatus,
    dates: { shippedAt?: Date; deliveredAt?: Date },
  ): Promise<boolean> {
    const result = await this.db.client.shipment.updateMany({
      where: { id, status: from },
      data: { status: to, ...dates },
    });
    return result.count === 1;
  }
}
