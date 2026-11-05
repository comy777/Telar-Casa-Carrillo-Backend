import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMAIN_EVENTS, type DomainEvents } from '../../../shared/application/domain-events';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../../../shared/config/env.schema';
import { jobsEnabled, ScheduledJob } from '../../../shared/presentation/scheduled-job';
import { StockReservations } from '../application/stock-reservations.service';

/** Cada minuto devuelve al stock las reservas de checkout vencidas. */
@Injectable()
export class ReservationExpiryJob {
  private readonly job: ScheduledJob;

  constructor(
    private readonly reservations: StockReservations,
    config: ConfigService<Env, true>,
    @Inject(DOMAIN_EVENTS) events: DomainEvents,
  ) {
    this.job = new ScheduledJob(ReservationExpiryJob.name, jobsEnabled(config), events);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  run(): Promise<void> {
    return this.job.run(async () => {
      const released = await this.reservations.releaseExpired();
      return released > 0 ? `Reservas vencidas liberadas: ${released}` : null;
    });
  }
}
