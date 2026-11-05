import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  ) {
    this.job = new ScheduledJob(GuestCartCleanupJob.name, jobsEnabled(config));
  }

  @Cron('17 * * * *')
  run(): Promise<void> {
    return this.job.run(async () => {
      const deleted = await this.carts.purgeExpiredGuestCarts();
      return deleted > 0 ? `Carritos de invitado vencidos borrados: ${deleted}` : null;
    });
  }
}
