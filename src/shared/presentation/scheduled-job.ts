import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

/** Activos salvo en pruebas, a menos que JOBS_ENABLED diga otra cosa. */
export function jobsEnabled(config: ConfigService<Env, true>): boolean {
  return (
    config.get('JOBS_ENABLED', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) !== 'test'
  );
}

/**
 * Ejecuta un proceso programado sin solaparse consigo mismo (si una corrida
 * tarda más que el intervalo, la siguiente se salta) y registrando errores sin
 * tumbar la aplicación.
 */
export class ScheduledJob {
  private running = false;
  private readonly logger: Logger;

  constructor(
    name: string,
    private readonly enabled: boolean,
  ) {
    this.logger = new Logger(name);
  }

  async run(work: () => Promise<string | null>): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const summary = await work();
      if (summary) this.logger.log(summary);
    } catch (error) {
      this.logger.error(
        'Falló el proceso programado',
        error instanceof Error ? error.stack : error,
      );
    } finally {
      this.running = false;
    }
  }
}
