import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type AfterCommit = () => Promise<void> | void;

interface ActiveTransaction {
  tx: Prisma.TransactionClient;
  afterCommit: AfterCommit[];
}

/** Guarda la transacción activa (y lo que debe correr al confirmarla) para la operación en curso. */
@Injectable()
export class PrismaTransactionContext {
  private readonly storage = new AsyncLocalStorage<ActiveTransaction>();

  run<T>(
    tx: Prisma.TransactionClient,
    afterCommit: AfterCommit[],
    work: () => Promise<T>,
  ): Promise<T> {
    return this.storage.run({ tx, afterCommit }, work);
  }

  current(): Prisma.TransactionClient | undefined {
    return this.storage.getStore()?.tx;
  }

  /** Cola de callbacks de la transacción activa, o undefined si no hay. */
  afterCommitQueue(): AfterCommit[] | undefined {
    return this.storage.getStore()?.afterCommit;
  }
}
