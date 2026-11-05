import { Injectable, Logger } from '@nestjs/common';
import type { UnitOfWork } from '../../application/unit-of-work';
import { PrismaService } from './prisma.service';
import { type AfterCommit, PrismaTransactionContext } from './prisma-transaction.context';

const TRANSACTION_TIMEOUT_MS = 10_000;

@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  private readonly logger = new Logger(PrismaUnitOfWork.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: PrismaTransactionContext,
  ) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    // Llamada anidada: se une a la transacción ya abierta.
    if (this.context.current()) {
      return work();
    }
    const afterCommit: AfterCommit[] = [];
    const result = await this.prisma.$transaction((tx) => this.context.run(tx, afterCommit, work), {
      timeout: TRANSACTION_TIMEOUT_MS,
    });
    for (const callback of afterCommit) await this.runSafely(callback);
    return result;
  }

  afterCommit(callback: AfterCommit): void {
    const queue = this.context.afterCommitQueue();
    if (queue) {
      queue.push(callback);
      return;
    }
    void this.runSafely(callback);
  }

  private async runSafely(callback: AfterCommit): Promise<void> {
    try {
      await callback();
    } catch (error) {
      this.logger.error(
        'Falló una tarea posterior al commit',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
