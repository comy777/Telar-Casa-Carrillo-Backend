/**
 * Utilidades compartidas por los scripts de respaldo. Usan pg_dump/pg_restore
 * de PostgreSQL (si no están en el PATH, indicar la carpeta en PG_BIN).
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Prisma acepta `?schema=public` en la URL; libpq (pg_dump) no. */
export function libpqUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete('schema');
  return url.toString();
}

export function withDatabase(databaseUrl: string, database: string): string {
  const url = new URL(libpqUrl(databaseUrl));
  url.pathname = `/${database}`;
  return url.toString();
}

export const databaseName = (databaseUrl: string): string => new URL(databaseUrl).pathname.slice(1);

export function pgTool(name: 'pg_dump' | 'pg_restore' | 'psql', args: string[]): string {
  const binary = process.env['PG_BIN'] ? join(process.env['PG_BIN'], name) : name;
  return execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('Falta DATABASE_URL');
  return url;
}
