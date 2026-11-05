import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema';
import { InventoryAdministration } from './application/inventory-administration.service';
import {
  INVENTORY_REPOSITORY,
  INVENTORY_SETTINGS,
  type InventorySettings,
  RESERVATION_REPOSITORY,
} from './application/ports';
import { StockReservations } from './application/stock-reservations.service';
import {
  PrismaInventoryRepository,
  PrismaReservationRepository,
} from './infrastructure/prisma-inventory.repositories';
import { AdminInventoryController } from './presentation/admin-inventory.controller';
import { ReservationExpiryJob } from './presentation/reservation-expiry.job';

@Module({
  controllers: [AdminInventoryController],
  providers: [
    {
      provide: INVENTORY_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): InventorySettings => ({
        reservationMinutes: config.get('CHECKOUT_RESERVATION_MINUTES', { infer: true }),
      }),
    },
    { provide: INVENTORY_REPOSITORY, useClass: PrismaInventoryRepository },
    { provide: RESERVATION_REPOSITORY, useClass: PrismaReservationRepository },
    InventoryAdministration,
    StockReservations,
    ReservationExpiryJob,
  ],
  // Otros módulos (carrito, checkout) usan solo esta API, nunca los repositorios.
  exports: [StockReservations],
})
export class InventoryModule {}
