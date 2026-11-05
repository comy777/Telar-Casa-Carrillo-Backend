/**
 * Simulacro de restauración: respalda la base (o usa el archivo indicado), lo
 * restaura en una base temporal, compara el número de filas de cada tabla con
 * la original y borra la temporal. Un respaldo que no se ha restaurado nunca
 * no es un respaldo. Uso: `npm run db:restore-check -- [archivo.dump]`.
 *
 * Necesita un usuario con permiso CREATEDB (como telar_app en desarrollo).
 */
import './load-env';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { backup } from './db-backup';
import { databaseName, libpqUrl, pgTool, requireDatabaseUrl, withDatabase } from './db-tools';

async function rowCounts(url: string): Promise<Map<string, number>> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    const counts = new Map<string, number>();
    for (const { table_name } of tables) {
      const [row] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count FROM "${table_name.replace(/"/g, '""')}"`,
      );
      counts.set(table_name, Number(row!.count));
    }
    return counts;
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const source = requireDatabaseUrl();
  const scratch = mkdtempSync(join(tmpdir(), 'telar-restore-'));
  const file = process.argv[2] ?? backup(source, scratch);
  const target = `${databaseName(source)}_restore_check_${Date.now()}`;
  const admin = libpqUrl(source);

  pgTool('psql', [admin, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${target}"`]);
  try {
    pgTool('pg_restore', [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      `--dbname=${withDatabase(source, target)}`,
      file,
    ]);
    const [expected, restored] = await Promise.all([
      rowCounts(source),
      rowCounts(withDatabase(source, target)),
    ]);
    const differences = [...expected].filter(([table, count]) => restored.get(table) !== count);
    if (differences.length > 0 || restored.size !== expected.size) {
      throw new Error(
        `La restauración no coincide: ${differences.map(([t, c]) => `${t} ${c}→${restored.get(t) ?? 'falta'}`).join(', ')}`,
      );
    }
    const rows = [...expected.values()].reduce((sum, count) => sum + count, 0);
    console.log(
      `Restauración verificada: ${expected.size} tablas y ${rows} filas coinciden (${file}).`,
    );
  } finally {
    pgTool('psql', [admin, '-c', `DROP DATABASE IF EXISTS "${target}"`]);
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
