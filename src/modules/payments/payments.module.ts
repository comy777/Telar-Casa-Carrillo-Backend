import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema';
import { OrderingModule } from '../ordering/ordering.module';
import { AWAITING_PAYMENT_CHECK } from '../ordering/presentation/order-expiry.job';
import { PaymentsService } from './application/payments.service';
import {
  PAYMENT_GATEWAY,
  PAYMENT_REPOSITORY,
  PAYMENT_SETTINGS,
  type PaymentGateway,
  type PaymentSettings,
  REFUND_REPOSITORY,
  WEBHOOK_EVENT_REPOSITORY,
} from './application/ports';
import { RefundsService } from './application/refunds.service';
import {
  PrismaPaymentRepository,
  PrismaRefundRepository,
  PrismaWebhookEventRepository,
} from './infrastructure/prisma-payment.repositories';
import { DisabledPaymentGateway, WompiGateway } from './infrastructure/wompi.gateway';
import { PaymentReconciliationJob } from './presentation/payment-reconciliation.job';
import {
  AdminPaymentsController,
  OrderPaymentsController,
  PaymentWebhooksController,
} from './presentation/payments.controllers';

/**
 * Global solo para exponer AWAITING_PAYMENT_CHECK al proceso que vence pedidos
 * (módulo de pedidos) sin crear una dependencia circular entre módulos.
 */
@Global()
@Module({
  imports: [OrderingModule],
  controllers: [OrderPaymentsController, PaymentWebhooksController, AdminPaymentsController],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentGateway => {
        const publicKey = config.get('WOMPI_PUBLIC_KEY', { infer: true });
        const privateKey = config.get('WOMPI_PRIVATE_KEY', { infer: true });
        const eventsSecret = config.get('WOMPI_EVENTS_SECRET', { infer: true });
        const integritySecret = config.get('WOMPI_INTEGRITY_SECRET', { infer: true });
        // La validación del entorno exige las cuatro juntas (y en producción, siempre).
        if (!publicKey || !privateKey || !eventsSecret || !integritySecret) {
          return new DisabledPaymentGateway();
        }
        return new WompiGateway({
          apiUrl: config.get('WOMPI_API_URL', { infer: true }),
          checkoutUrl: config.get('WOMPI_CHECKOUT_URL', { infer: true }),
          publicKey,
          privateKey,
          eventsSecret,
          integritySecret,
        });
      },
    },
    {
      provide: PAYMENT_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentSettings => ({
        storefrontUrl: config.get('STOREFRONT_URL', { infer: true }),
      }),
    },
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    { provide: REFUND_REPOSITORY, useClass: PrismaRefundRepository },
    { provide: WEBHOOK_EVENT_REPOSITORY, useClass: PrismaWebhookEventRepository },
    PaymentsService,
    RefundsService,
    PaymentReconciliationJob,
    { provide: AWAITING_PAYMENT_CHECK, useExisting: PaymentsService },
  ],
  exports: [AWAITING_PAYMENT_CHECK, PaymentsService],
})
export class PaymentsModule {}
