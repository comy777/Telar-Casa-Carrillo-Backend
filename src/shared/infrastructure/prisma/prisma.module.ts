import { Global, Module } from '@nestjs/common';
import { UNIT_OF_WORK } from '../../application/unit-of-work';
import { PrismaClientProvider } from './prisma-client.provider';
import { PrismaService } from './prisma.service';
import { PrismaTransactionContext } from './prisma-transaction.context';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

@Global()
@Module({
  providers: [
    PrismaService,
    PrismaTransactionContext,
    PrismaClientProvider,
    PrismaUnitOfWork,
    { provide: UNIT_OF_WORK, useExisting: PrismaUnitOfWork },
  ],
  exports: [PrismaService, PrismaClientProvider, UNIT_OF_WORK],
})
export class PrismaModule {}
