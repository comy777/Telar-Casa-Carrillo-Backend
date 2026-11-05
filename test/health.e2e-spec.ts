import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';

describe('API (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = (): App => app.getHttpServer();

  it('GET /api/health responde ok cuando la base de datos está arriba', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const response = await request(server()).get('/api/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('GET /api/health responde 503 en formato problem+json si la base de datos falla', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    const response = await request(server()).get('/api/health').expect(503);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ status: 503, instance: '/api/health' });
    expect(JSON.stringify(response.body)).not.toContain('connection refused');
  });

  it('reutiliza un x-request-id válido enviado por el cliente', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const response = await request(server())
      .get('/api/health')
      .set('x-request-id', 'abc-123')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('abc-123');
  });

  it('una ruta inexistente responde 404 en formato problem+json', async () => {
    const response = await request(server()).get('/api/v1/no-existe').expect(404);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ status: 404, title: 'No encontrado' });
  });

  it('aplica las cabeceras de seguridad de Helmet', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const response = await request(server()).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
