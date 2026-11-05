/**
 * Respaldo de la base en formato custom de pg_dump (comprimido, restaurable
 * por tablas). Uso: `npm run db:backup -- [carpeta]` (por defecto ./backups).
 *
 * En producción, programarlo a diario y copiar el archivo FUERA del servidor
 * de la base (otro proveedor o bucket con versionado). Ver docs/operations.md.
 */
import './load-env';
import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { databaseName, libpqUrl, pgTool, requireDatabaseUrl } from './db-tools';

export function backup(databaseUrl: string, directory: string): string {
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(directory, `${databaseName(databaseUrl)}-${stamp}.dump`);
  pgTool('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${file}`,
    libpqUrl(databaseUrl),
  ]);
  return file;
}

if (require.main === module) {
  try {
    const file = backup(requireDatabaseUrl(), resolve(process.argv[2] ?? 'backups'));
    console.log(`Respaldo creado: ${file} (${Math.round(statSync(file).size / 1024)} KB)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
