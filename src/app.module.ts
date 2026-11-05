import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './modules/audit/audit.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrderingModule } from './modules/ordering/ordering.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { type Env, validateEnv } from './shared/config/env.schema';
import { LoggingModule } from './shared/infrastructure/logging/logger.module';
import { PlatformModule } from './shared/infrastructure/platform.module';
import { PrismaModule } from './shared/infrastructure/prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggingModule,
    // Límite general; las rutas sensibles (login, registro, recuperación) tienen uno más estricto.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        // Las pruebas e2e hacen muchas peticiones seguidas desde la misma IP.
        skipIf: () => config.get('NODE_ENV', { infer: true }) === 'test',
      }),
    }),
    // Los procesos programados se activan o no con JOBS_ENABLED (ver scheduled-job.ts).
    ScheduleModule.forRoot(),
    PrismaModule,
    PlatformModule,
    AuditModule,
    IdentityModule,
    CatalogModule,
    InventoryModule,
    CartModule,
    ShippingModule,
    PromotionsModule,
    OrderingModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
