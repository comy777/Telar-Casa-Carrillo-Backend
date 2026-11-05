import type { Prisma } from '@prisma/client';
import { PrismaClientProvider } from './prisma-client.provider';
import type { PrismaService } from './prisma.service';
import { PrismaTransactionContext } from './prisma-transaction.context';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

describe('PrismaUnitOfWork', () => {
  const tx = { name: 'tx' } as unknown as Prisma.TransactionClient;
  let transaction: jest.Mock;
  let prisma: PrismaService;
  let context: PrismaTransactionContext;
  let unitOfWork: PrismaUnitOfWork;
  let provider: PrismaClientProvider;

  beforeEach(() => {
    transaction = jest.fn((work: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      work(tx),
    );
    prisma = { $transaction: transaction } as unknown as PrismaService;
    context = new PrismaTransactionContext();
    unitOfWork = new PrismaUnitOfWork(prisma, context);
    provider = new PrismaClientProvider(prisma, context);
  });

  it('fuera de una transacción los repositorios usan el cliente normal', () => {
    expect(provider.client).toBe(prisma);
  });

  it('dentro de execute los repositorios reciben la transacción', async () => {
    const seen = await unitOfWork.execute(() => Promise.resolve(provider.client));
    expect(seen).toBe(tx);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('las llamadas anidadas reutilizan la transacción abierta', async () => {
    await unitOfWork.execute(() => unitOfWork.execute(() => Promise.resolve(provider.client)));
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('al terminar vuelve al cliente normal', async () => {
    await unitOfWork.execute(() => Promise.resolve());
    expect(provider.client).toBe(prisma);
  });

  it('propaga los errores para que Prisma revierta la transacción', async () => {
    await expect(unitOfWork.execute(() => Promise.reject(new Error('falló')))).rejects.toThrow(
      'falló',
    );
  });
});
