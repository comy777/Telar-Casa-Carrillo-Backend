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

describe('PrismaUnitOfWork.afterCommit', () => {
  const tx = {} as Prisma.TransactionClient;

  const build = (fails = false) => {
    const prisma = {
      $transaction: jest.fn(
        async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => {
          const result = await work(tx);
          if (fails) throw new Error('rollback');
          return result;
        },
      ),
    } as unknown as PrismaService;
    return new PrismaUnitOfWork(prisma, new PrismaTransactionContext());
  };

  it('corre después de confirmar, no durante la transacción', async () => {
    const unitOfWork = build();
    const calls: string[] = [];
    await unitOfWork.execute(async () => {
      unitOfWork.afterCommit(() => {
        calls.push('después');
      });
      await unitOfWork.execute(() => {
        unitOfWork.afterCommit(() => {
          calls.push('anidada');
        });
        return Promise.resolve();
      });
      calls.push('dentro');
    });
    expect(calls).toEqual(['dentro', 'después', 'anidada']);
  });

  it('no corre si la transacción se revierte', async () => {
    const unitOfWork = build(true);
    const callback = jest.fn();
    await expect(
      unitOfWork.execute(() => {
        unitOfWork.afterCommit(callback);
        return Promise.resolve();
      }),
    ).rejects.toThrow('rollback');
    expect(callback).not.toHaveBeenCalled();
  });

  it('sin transacción corre de inmediato y sus errores no se propagan', async () => {
    const unitOfWork = build();
    const callback = jest.fn().mockRejectedValue(new Error('correo caído'));
    unitOfWork.afterCommit(callback);
    await new Promise((resolve) => setImmediate(resolve));
    expect(callback).toHaveBeenCalled();
  });
});
