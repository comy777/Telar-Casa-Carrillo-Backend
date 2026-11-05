import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema';
import { CartModule } from '../cart/cart.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CheckoutService } from './application/checkout.service';
import { CustomerOrders, OrderAdministration, OrderLifecycle } from './application/orders.services';
import {
  ELECTRONIC_INVOICE_ISSUER,
  ORDER_ACCESS_TOKENS,
  ORDER_REPOSITORY,
  ORDERING_SETTINGS,
  type OrderingSettings,
} from './application/ports';
import {
  CryptoOrderAccessTokens,
  ManualInvoiceIssuer,
  PrismaOrderRepository,
} from './infrastructure/prisma-order.adapters';
import { OrderExpiryJob } from './presentation/order-expiry.job';
import {
  AdminOrdersController,
  CheckoutController,
  CustomerOrdersController,
} from './presentation/ordering.controllers';

@Module({
  imports: [CartModule, InventoryModule, PromotionsModule, ShippingModule],
  controllers: [CheckoutController, CustomerOrdersController, AdminOrdersController],
  providers: [
    {
      provide: ORDERING_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): OrderingSettings => ({
        paymentMinutes: config.get('ORDER_PAYMENT_MINUTES', { infer: true }),
        orderNumberPrefix: config.get('ORDER_NUMBER_PREFIX', { infer: true }),
        shippingTaxBasisPoints: Math.round(
          config.get('SHIPPING_TAX_RATE', { infer: true }) * 10_000,
        ),
        storefrontUrl: config.get('STOREFRONT_URL', { infer: true }),
        privacyPolicyVersion: config.get('PRIVACY_POLICY_VERSION', { infer: true }),
      }),
    },
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    { provide: ORDER_ACCESS_TOKENS, useClass: CryptoOrderAccessTokens },
    // Sin proveedor tecnológico de facturación configurado: registro manual.
    { provide: ELECTRONIC_INVOICE_ISSUER, useClass: ManualInvoiceIssuer },
    CheckoutService,
    CustomerOrders,
    OrderLifecycle,
    OrderAdministration,
    OrderExpiryJob,
  ],
  exports: [OrderLifecycle, OrderExpiryJob],
})
export class OrderingModule {}
