import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../../../shared/config/env.schema';
import { jobsEnabled, ScheduledJob } from '../../../shared/presentation/scheduled-job';
import { OrderLifecycle } from '../application/orders.services';

/**
 * Indica si un pedido tiene un pago en curso en la pasarela (p. ej. PSE sin
 * respuesta todavía). Lo provee el módulo de pagos; sin él, ninguno espera.
 */
export interface AwaitingPaymentCheck {
  isAwaitingPayment(orderId: string): Promise<boolean>;
}
export const AWAITING_PAYMENT_CHECK = Symbol('AwaitingPaymentCheck');

/** Cada minuto cancela los pedidos sin pagar cuyo plazo venció y devuelve su stock. */
@Injectable()
export class OrderExpiryJob {
  private readonly job: ScheduledJob;

  constructor(
    private readonly lifecycle: OrderLifecycle,
    config: ConfigService<Env, true>,
    @Optional() @Inject(AWAITING_PAYMENT_CHECK) private readonly payments?: AwaitingPaymentCheck,
  ) {
    this.job = new ScheduledJob(OrderExpiryJob.name, jobsEnabled(config));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  run(): Promise<void> {
    return this.job.run(async () => {
      const expired = await this.expire();
      return expired > 0 ? `Pedidos vencidos sin pago cancelados: ${expired}` : null;
    });
  }

  expire(): Promise<number> {
    return this.lifecycle.expireOverdue((id) =>
      this.payments ? this.payments.isAwaitingPayment(id) : Promise.resolve(false),
    );
  }
}
