import { z } from 'zod';

/** En .env una variable vacía (`SMTP_HOST=`) cuenta como no definida. */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());

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

const commaSeparatedOrigins = z
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

const PLACEHOLDER_SECRET = /replace|change_this|changeme|secret$/i;

/**
 * Variables de entorno que la API necesita para arrancar.
 * Cada módulo agrega aquí las suyas cuando se implementa.
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
    CORS_ORIGINS: commaSeparatedOrigins,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // URL pública de la tienda: los enlaces de los correos apuntan aquí.
    STOREFRONT_URL: z.string().refine(isHttpOrigin, 'Debe tener la forma http(s)://host[:puerto]'),

    // Identidad
    JWT_ACCESS_SECRET: z.string().min(32, 'Debe tener al menos 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(10).max(1440).default(60),
    // Versión de la política de tratamiento de datos que acepta quien se registra (Ley 1581).
    PRIVACY_POLICY_VERSION: z.string().min(1).default('2026-11'),

    // Correo. Sin SMTP_HOST (solo fuera de producción) los correos se escriben en el log.
    SMTP_HOST: optional(z.string()),
    SMTP_PORT: optional(z.coerce.number().int().min(1).max(65535)),
    SMTP_USER: optional(z.string()),
    SMTP_PASSWORD: optional(z.string()),
    EMAIL_FROM: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    const require = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    require(env.CORS_ORIGINS.length >
      0, 'CORS_ORIGINS', 'En producción debe definirse al menos un origen permitido');
    require(!PLACEHOLDER_SECRET.test(
      env.JWT_ACCESS_SECRET,
    ), 'JWT_ACCESS_SECRET', 'En producción no se puede usar el valor de ejemplo');
    require(Boolean(
      env.SMTP_HOST,
    ), 'SMTP_HOST', 'En producción los correos deben enviarse por SMTP');
    require(Boolean(env.EMAIL_FROM), 'EMAIL_FROM', 'En producción debe definirse el remitente');
    require(env.STOREFRONT_URL.startsWith(
      'https://',
    ), 'STOREFRONT_URL', 'En producción la tienda debe usar HTTPS');
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
