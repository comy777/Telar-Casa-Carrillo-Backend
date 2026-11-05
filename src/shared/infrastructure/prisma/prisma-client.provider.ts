import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { PrismaTransactionContext } from './prisma-transaction.context';

/**
 * Los repositorios Prisma usan `this.db.client` en lugar de PrismaService:
 * dentro de UnitOfWork.execute obtienen la transacción activa; fuera, el cliente normal.
 */
@Injectable()
export class PrismaClientProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: PrismaTransactionContext,
  ) {}

  get client(): Prisma.TransactionClient {
    return this.context.current() ?? this.prisma;
  }
}
