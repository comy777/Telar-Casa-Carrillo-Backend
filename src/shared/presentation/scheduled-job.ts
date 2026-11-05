import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DomainEvents } from '../application/domain-events';
import type { Env } from '../config/env.schema';

/** Activos salvo en pruebas, a menos que JOBS_ENABLED diga otra cosa. */
export function jobsEnabled(config: ConfigService<Env, true>): boolean {
  return (
    config.get('JOBS_ENABLED', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) !== 'test'
  );
}

export interface JobStatus {
  name: string;
  enabled: boolean;
  running: boolean;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
}

/** Estado de los procesos de esta instancia, para el panel de monitoreo. */
const registry = new Map<string, JobStatus>();
export const jobStatuses = (): JobStatus[] =>
  [...registry.values()].map((status) => ({ ...status }));

/**
 * Ejecuta un proceso programado sin solaparse consigo mismo (si una corrida
 * tarda más que el intervalo, la siguiente se salta), registrando su estado y
 * avisando (job.failed) cuando falla, sin tumbar la aplicación.
 */
export class ScheduledJob {
  private readonly logger: Logger;
  private readonly status: JobStatus;

  constructor(
    name: string,
    enabled: boolean,
    private readonly events?: DomainEvents,
  ) {
    this.logger = new Logger(name);
    this.status = {
      name,
      enabled,
      running: false,
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      consecutiveFailures: 0,
    };
    registry.set(name, this.status);
  }

  async run(work: () => Promise<string | null>): Promise<void> {
    if (!this.status.enabled || this.status.running) return;
    this.status.running = true;
    this.status.lastRunAt = new Date();
    try {
      const summary = await work();
      if (summary) this.logger.log(summary);
      this.status.lastSuccessAt = new Date();
      this.status.consecutiveFailures = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status.lastErrorAt = new Date();
      this.status.lastError = message.slice(0, 500);
      this.status.consecutiveFailures += 1;
      this.logger.error(
        'Falló el proceso programado',
        error instanceof Error ? error.stack : error,
      );
      // Se avisa al primer fallo, no en cada corrida fallida.
      if (this.status.consecutiveFailures === 1) {
        this.events?.publish({
          type: 'job.failed',
          job: this.status.name,
          error: message.slice(0, 500),
        });
      }
    } finally {
      this.status.running = false;
    }
  }
}
