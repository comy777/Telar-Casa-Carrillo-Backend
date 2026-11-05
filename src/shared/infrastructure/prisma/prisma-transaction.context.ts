import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Guarda la transacción activa para la petición/caso de uso en curso. */
@Injectable()
export class PrismaTransactionContext {
  private readonly storage = new AsyncLocalStorage<Prisma.TransactionClient>();

  run<T>(tx: Prisma.TransactionClient, work: () => Promise<T>): Promise<T> {
    return this.storage.run(tx, work);
  }

  current(): Prisma.TransactionClient | undefined {
    return this.storage.getStore();
  }
}
