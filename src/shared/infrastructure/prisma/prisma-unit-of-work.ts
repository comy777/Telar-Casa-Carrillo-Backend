import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../application/unit-of-work';
import { PrismaService } from './prisma.service';
import { PrismaTransactionContext } from './prisma-transaction.context';

const TRANSACTION_TIMEOUT_MS = 10_000;

@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: PrismaTransactionContext,
  ) {}

  execute<T>(work: () => Promise<T>): Promise<T> {
    // Llamada anidada: se une a la transacción ya abierta.
    if (this.context.current()) {
      return work();
    }
    return this.prisma.$transaction((tx) => this.context.run(tx, work), {
      timeout: TRANSACTION_TIMEOUT_MS,
    });
  }
}
