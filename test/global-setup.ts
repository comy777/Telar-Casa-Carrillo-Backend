import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { seedAccessControl } from '../prisma/seed';
import { TEST_DATABASE_URL } from './test-env';

/**
 * Prepara la base de pruebas: aplica las migraciones pendientes (la crea si no
 * existe) y sincroniza los roles. No borra la base; cada prueba vacía las
 * tablas que usa (ver support/test-app.ts).
 */
export default async function globalSetup(): Promise<void> {
  // Las pruebas vacían tablas: nunca contra una base que no sea de pruebas.
  const databaseName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error(`La base de pruebas debe terminar en "_test" (es "${databaseName}")`);
  }
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  try {
    await seedAccessControl(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
