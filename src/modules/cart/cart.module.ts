import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema';
import { InventoryModule } from '../inventory/inventory.module';
import { CartService } from './application/cart.service';
import {
  CART_CATALOG,
  CART_REPOSITORY,
  CART_SETTINGS,
  type CartSettings,
  GUEST_CART_KEYS,
} from './application/ports';
import {
  CryptoGuestCartKeys,
  PrismaCartCatalog,
  PrismaCartRepository,
} from './infrastructure/prisma-cart.adapters';
import { GUEST_CART_TTL_DAYS, SECURE_CART_COOKIE } from './presentation/cart-cookie';
import { CartController } from './presentation/cart.controller';
import { GuestCartCleanupJob } from './presentation/guest-cart-cleanup.job';

@Module({
  imports: [InventoryModule],
  controllers: [CartController],
  providers: [
    {
      provide: CART_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): CartSettings => ({
        guestCartTtlDays: config.get('GUEST_CART_TTL_DAYS', { infer: true }),
      }),
    },
    {
      provide: GUEST_CART_TTL_DAYS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): number =>
        config.get('GUEST_CART_TTL_DAYS', { infer: true }),
    },
    {
      provide: SECURE_CART_COOKIE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('NODE_ENV', { infer: true }) === 'production',
    },
    { provide: CART_REPOSITORY, useClass: PrismaCartRepository },
    { provide: CART_CATALOG, useClass: PrismaCartCatalog },
    { provide: GUEST_CART_KEYS, useClass: CryptoGuestCartKeys },
    CartService,
    GuestCartCleanupJob,
  ],
  exports: [CartService, SECURE_CART_COOKIE, GUEST_CART_TTL_DAYS],
})
export class CartModule {}
