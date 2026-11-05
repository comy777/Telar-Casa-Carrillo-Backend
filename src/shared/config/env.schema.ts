import { readFileSync } from 'node:fs';
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
    // Proxies de confianza delante de la API (balanceador, CDN). Con 0 se usa la
    // IP de la conexión; detrás de un proxy hay que indicar cuántos saltos hay,
    // o el límite de peticiones y la auditoría verán siempre la IP del proxy.
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // URL pública de la tienda: los enlaces de los correos apuntan aquí.
    STOREFRONT_URL: z.string().refine(isHttpOrigin, 'Debe tener la forma http(s)://host[:puerto]'),
    // Panel de administración: los enlaces de las alertas apuntan aquí.
    ADMIN_URL: z
      .string()
      .default('http://localhost:3002')
      .refine(isHttpOrigin, 'Debe tener la forma http(s)://host[:puerto]'),

    // Identidad
    JWT_ACCESS_SECRET: z.string().min(32, 'Debe tener al menos 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(10).max(1440).default(60),
    // Versión de la política de tratamiento de datos que acepta quien se registra (Ley 1581).
    PRIVACY_POLICY_VERSION: z.string().min(1).default('2026-11'),

    // URL pública de la API: la usan las imágenes guardadas en disco (desarrollo).
    API_PUBLIC_URL: z
      .string()
      .default('http://localhost:3001')
      .refine(isHttpOrigin, 'Debe tener la forma http(s)://host[:puerto]'),

    // Imágenes. Con CLOUDINARY_CLOUD_NAME se usa Cloudinary; sin él (solo fuera
    // de producción) se guardan en MEDIA_LOCAL_DIR y las sirve la API en /media.
    CLOUDINARY_CLOUD_NAME: optional(z.string()),
    CLOUDINARY_API_KEY: optional(z.string()),
    CLOUDINARY_API_SECRET: optional(z.string()),
    CLOUDINARY_FOLDER: z
      .string()
      .regex(/^[\w-]+$/)
      .default('telar-casa-carrillo'),
    MEDIA_LOCAL_DIR: z.string().min(1).default('uploads'),

    // Carrito e inventario
    // Minutos que el stock queda apartado al iniciar el checkout.
    CHECKOUT_RESERVATION_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    // Días sin cambios tras los que se borra un carrito de invitado.
    GUEST_CART_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    // Pedidos
    // Minutos para pagar un pedido; después se cancela y el stock vuelve (PSE puede tardar).
    ORDER_PAYMENT_MINUTES: z.coerce.number().int().min(10).max(1440).default(60),
    // Prefijo del número de pedido: TCC-000123.
    ORDER_NUMBER_PREFIX: z
      .string()
      .regex(/^[A-Z]{2,6}$/)
      .default('TCC'),
    // IVA incluido en el costo de envío (confirmar con el contador).
    SHIPPING_TAX_RATE: z.coerce.number().min(0).max(1).default(0.19),

    // Pagos (Wompi). Sin llaves (solo fuera de producción) los pagos quedan desactivados.
    PAYMENT_PROVIDER: z.enum(['wompi']).default('wompi'),
    WOMPI_API_URL: z
      .string()
      .url()
      .default('https://sandbox.wompi.co/v1')
      .transform((url) => url.replace(/\/+$/, '')),
    WOMPI_CHECKOUT_URL: z.string().url().default('https://checkout.wompi.co/p/'),
    WOMPI_PUBLIC_KEY: optional(z.string()),
    WOMPI_PRIVATE_KEY: optional(z.string()),
    WOMPI_EVENTS_SECRET: optional(z.string()),
    WOMPI_INTEGRITY_SECRET: optional(z.string()),

    // Correos de la tienda: pedidos pagados y alertas (pagos a revisar, poco
    // stock, procesos que fallan). Lista separada por comas; vacía = solo logs.
    ADMIN_ALERT_EMAILS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().email('Cada correo de ADMIN_ALERT_EMAILS debe ser válido'))),

    // Procesos programados (liberar reservas, limpiar carritos). Por defecto
    // activos salvo en pruebas. Con varias instancias pueden correr en todas:
    // las operaciones son seguras ante ejecuciones simultáneas.
    JOBS_ENABLED: optional(z.enum(['true', 'false']).transform((value) => value === 'true')),

    // Correo. Sin SMTP_HOST (solo fuera de producción) los correos se escriben en el log.
    SMTP_HOST: optional(z.string()),
    SMTP_PORT: optional(z.coerce.number().int().min(1).max(65535)),
    SMTP_USER: optional(z.string()),
    SMTP_PASSWORD: optional(z.string()),
    EMAIL_FROM: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    const require = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };

    if (env.CLOUDINARY_CLOUD_NAME) {
      require(Boolean(
        env.CLOUDINARY_API_KEY,
      ), 'CLOUDINARY_API_KEY', 'Falta la clave de Cloudinary');
      require(Boolean(
        env.CLOUDINARY_API_SECRET,
      ), 'CLOUDINARY_API_SECRET', 'Falta el secreto de Cloudinary');
    }

    // Wompi: las cuatro llaves van juntas y deben ser del mismo ambiente que la URL.
    const wompi = {
      WOMPI_PUBLIC_KEY: env.WOMPI_PUBLIC_KEY,
      WOMPI_PRIVATE_KEY: env.WOMPI_PRIVATE_KEY,
      WOMPI_EVENTS_SECRET: env.WOMPI_EVENTS_SECRET,
      WOMPI_INTEGRITY_SECRET: env.WOMPI_INTEGRITY_SECRET,
    };
    const configured = Object.values(wompi).some(Boolean);
    if (configured || env.NODE_ENV === 'production') {
      for (const [key, value] of Object.entries(wompi)) {
        require(Boolean(value), key, 'Faltan llaves de Wompi (se configuran las cuatro juntas)');
      }
      const sandbox = env.WOMPI_API_URL.includes('sandbox');
      const prefixes: [string, string | undefined, string, string][] = [
        ['WOMPI_PUBLIC_KEY', env.WOMPI_PUBLIC_KEY, 'pub_test_', 'pub_prod_'],
        ['WOMPI_PRIVATE_KEY', env.WOMPI_PRIVATE_KEY, 'prv_test_', 'prv_prod_'],
        ['WOMPI_EVENTS_SECRET', env.WOMPI_EVENTS_SECRET, 'test_events_', 'prod_events_'],
        [
          'WOMPI_INTEGRITY_SECRET',
          env.WOMPI_INTEGRITY_SECRET,
          'test_integrity_',
          'prod_integrity_',
        ],
      ];
      for (const [key, value, test, prod] of prefixes) {
        if (!value) continue;
        require(value.startsWith(
          sandbox ? test : prod,
        ), key, `Con ${env.WOMPI_API_URL} la llave debe empezar por ${sandbox ? test : prod}`);
      }
    }

    if (env.NODE_ENV !== 'production') return;

    require(Boolean(
      env.CLOUDINARY_CLOUD_NAME,
    ), 'CLOUDINARY_CLOUD_NAME', 'En producción las imágenes deben guardarse en Cloudinary');
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

/**
 * Secretos montados como archivos (Docker/Kubernetes secrets, gestores de
 * secretos): `JWT_ACCESS_SECRET_FILE=/run/secrets/jwt` carga JWT_ACCESS_SECRET
 * desde ese archivo si la variable no está definida directamente.
 */
export function resolveFileSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const resolved = { ...config };
  for (const [key, path] of Object.entries(config)) {
    if (!key.endsWith('_FILE') || typeof path !== 'string' || !path) continue;
    const target = key.slice(0, -'_FILE'.length);
    if (resolved[target] !== undefined && resolved[target] !== '') continue;
    try {
      resolved[target] = readFileSync(path, 'utf8').trim();
    } catch {
      throw new Error(`Variables de entorno inválidas:\n- ${key}: no se pudo leer ${path}`);
    }
  }
  return resolved;
}

/** Usado por ConfigModule: falla al arrancar si falta o sobra algo. */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(resolveFileSecrets(config));
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return result.data;
}
