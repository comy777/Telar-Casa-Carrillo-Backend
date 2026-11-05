import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMAIN_EVENTS, type DomainEvents } from '../../../shared/application/domain-events';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../../../shared/config/env.schema';
import { jobsEnabled, ScheduledJob } from '../../../shared/presentation/scheduled-job';
import { PaymentsService } from '../application/payments.service';

/**
 * Cada 5 minutos consulta a la pasarela los pagos que siguen pendientes, por
 * si se perdió una notificación (la pasarela solo reintenta 3 veces en 24 h).
 */
@Injectable()
export class PaymentReconciliationJob {
  private readonly job: ScheduledJob;

  constructor(
    private readonly payments: PaymentsService,
    config: ConfigService<Env, true>,
    @Inject(DOMAIN_EVENTS) events: DomainEvents,
  ) {
    const configured = Boolean(config.get('WOMPI_PRIVATE_KEY', { infer: true }));
    this.job = new ScheduledJob(
      PaymentReconciliationJob.name,
      configured && jobsEnabled(config),
      events,
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  run(): Promise<void> {
    return this.job.run(async () => {
      const updated = await this.payments.reconcile();
      return updated > 0 ? `Pagos conciliados con la pasarela: ${updated}` : null;
    });
  }
}
