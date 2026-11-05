import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMAIN_EVENTS, type DomainEvents } from '../../../shared/application/domain-events';
import { Cron } from '@nestjs/schedule';
import type { Env } from '../../../shared/config/env.schema';
import { jobsEnabled, ScheduledJob } from '../../../shared/presentation/scheduled-job';
import { CartService } from '../application/cart.service';

/** Cada hora borra carritos de invitado sin actividad (ver GUEST_CART_TTL_DAYS). */
@Injectable()
export class GuestCartCleanupJob {
  private readonly job: ScheduledJob;

  constructor(
    private readonly carts: CartService,
    config: ConfigService<Env, true>,
    @Inject(DOMAIN_EVENTS) events: DomainEvents,
  ) {
    this.job = new ScheduledJob(GuestCartCleanupJob.name, jobsEnabled(config), events);
  }

  @Cron('17 * * * *')
  run(): Promise<void> {
    return this.job.run(async () => {
      const deleted = await this.carts.purgeExpiredGuestCarts();
      return deleted > 0 ? `Carritos de invitado vencidos borrados: ${deleted}` : null;
    });
  }
}
