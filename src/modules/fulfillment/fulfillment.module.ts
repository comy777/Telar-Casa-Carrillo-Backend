import { Module } from '@nestjs/common';
import { OrderingModule } from '../ordering/ordering.module';
import { FulfillmentService, SHIPMENT_REPOSITORY } from './application/fulfillment.service';
import { PrismaShipmentRepository } from './infrastructure/prisma-shipment.repository';
import {
  AdminShipmentsController,
  TrackingController,
} from './presentation/fulfillment.controllers';

/** Despachos y seguimiento de pedidos (el módulo de envíos tiene direcciones y métodos). */
@Module({
  imports: [OrderingModule],
  controllers: [TrackingController, AdminShipmentsController],
  providers: [
    { provide: SHIPMENT_REPOSITORY, useClass: PrismaShipmentRepository },
    FulfillmentService,
  ],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
