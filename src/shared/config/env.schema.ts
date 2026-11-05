import { z } from 'zod';

const commaSeparatedUrls = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(
    z.array(
      z
        .string()
        .refine(isHttpOrigin, 'Cada origen de CORS debe tener la forma http(s)://host[:puerto]'),
    ),
  );

/**
 * Un origen como el que envía el navegador: protocolo http/https, host y puerto
 * opcional, sin ruta ni barra final. `new URL('localhost:3000')` es válido
 * (toma "localhost:" como protocolo), por eso se compara con `origin`.
 */
function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

/**
 * Variables de entorno que la API necesita para arrancar.
 * Cada módulo agrega aquí las suyas cuando se implemente (JWT, pagos, correo...).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (url) => url.startsWith('postgresql://') || url.startsWith('postgres://'),
        'Debe ser una URL de PostgreSQL',
      ),
    CORS_ORIGINS: commaSeparatedUrls,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'En producción debe definirse al menos un origen permitido',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Usado por ConfigModule: falla al arrancar si falta o sobra algo. */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return result.data;
}
