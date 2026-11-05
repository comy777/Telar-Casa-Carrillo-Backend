import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  STOREFRONT_URL: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'a-development-secret-with-32-chars!!',
};

const production = {
  ...base,
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://telarcasacarrillo.co',
  STOREFRONT_URL: 'https://telarcasacarrillo.co',
  JWT_ACCESS_SECRET: 'Zq3kV9xLw2NfT8pR4sY7uB1mC6hJ0dGe5aKiOt',
  SMTP_HOST: 'smtp.example.com',
  EMAIL_FROM: 'Telar <no-reply@telarcasacarrillo.co>',
  CLOUDINARY_CLOUD_NAME: 'telar',
  CLOUDINARY_API_KEY: '123456789012345',
  CLOUDINARY_API_SECRET: 'cloudinary-api-secret-value',
  WOMPI_API_URL: 'https://production.wompi.co/v1',
  WOMPI_PUBLIC_KEY: 'pub_prod_abc',
  WOMPI_PRIVATE_KEY: 'prv_prod_abc',
  WOMPI_EVENTS_SECRET: 'prod_events_abc',
  WOMPI_INTEGRITY_SECRET: 'prod_integrity_abc',
};

describe('validateEnv', () => {
  it('aplica valores por defecto', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 3001,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: [],
    });
  });

  it('convierte el puerto y separa los orígenes de CORS', () => {
    const env = validateEnv({
      ...base,
      API_PORT: '4000',
      CORS_ORIGINS: 'http://localhost:3000, http://localhost:3002',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3002']);
  });

  it('rechaza una URL de base de datos que no es PostgreSQL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://user:pass@localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it.each([
    'localhost:3000',
    'ftp://example.com',
    'https://example.com/',
    'https://example.com/tienda',
  ])('rechaza el origen de CORS %s', (origin) => {
    expect(() => validateEnv({ ...base, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
  });

  it('exige orígenes de CORS en producción', () => {
    expect(() => validateEnv({ ...production, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
  });

  it('acepta una configuración de producción completa', () => {
    expect(validateEnv(production).NODE_ENV).toBe('production');
  });

  it('trata las variables vacías como no definidas', () => {
    expect(validateEnv({ ...base, SMTP_HOST: '', SMTP_PORT: '' })).toMatchObject({
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
    });
  });

  it('rechaza un secreto JWT corto', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'corto' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it.each([
    ['JWT_ACCESS_SECRET', 'replace_with_a_long_random_secret_of_at_least_32_chars'],
    ['SMTP_HOST', ''],
    ['EMAIL_FROM', ''],
    ['STOREFRONT_URL', 'http://telarcasacarrillo.co'],
    ['CLOUDINARY_CLOUD_NAME', ''],
  ])('en producción rechaza %s = "%s"', (key, value) => {
    expect(() => validateEnv({ ...production, [key]: value })).toThrow(new RegExp(key));
  });
});

describe('validateEnv: imágenes', () => {
  it('exige clave y secreto cuando se configura Cloudinary', () => {
    expect(() => validateEnv({ ...base, CLOUDINARY_CLOUD_NAME: 'telar' })).toThrow(
      /CLOUDINARY_API_KEY[\s\S]*CLOUDINARY_API_SECRET/,
    );
  });

  it('usa disco local por defecto fuera de producción', () => {
    const env = validateEnv(base);
    expect(env.CLOUDINARY_CLOUD_NAME).toBeUndefined();
    expect(env).toMatchObject({
      MEDIA_LOCAL_DIR: 'uploads',
      API_PUBLIC_URL: 'http://localhost:3001',
    });
  });
});

describe('validateEnv: Wompi', () => {
  const sandbox = {
    ...base,
    WOMPI_PUBLIC_KEY: 'pub_test_abc',
    WOMPI_PRIVATE_KEY: 'prv_test_abc',
    WOMPI_EVENTS_SECRET: 'test_events_abc',
    WOMPI_INTEGRITY_SECRET: 'test_integrity_abc',
  };

  it('acepta llaves de sandbox con la URL de sandbox', () => {
    expect(validateEnv(sandbox).WOMPI_API_URL).toBe('https://sandbox.wompi.co/v1');
  });

  it('exige las cuatro llaves juntas', () => {
    expect(() => validateEnv({ ...sandbox, WOMPI_EVENTS_SECRET: '' })).toThrow(
      /WOMPI_EVENTS_SECRET/,
    );
  });

  it('rechaza llaves de producción con la URL de sandbox', () => {
    expect(() => validateEnv({ ...sandbox, WOMPI_PRIVATE_KEY: 'prv_prod_abc' })).toThrow(
      /WOMPI_PRIVATE_KEY/,
    );
  });

  it('en producción exige Wompi', () => {
    expect(() => validateEnv({ ...production, WOMPI_PUBLIC_KEY: '' })).toThrow(/WOMPI_PUBLIC_KEY/);
  });
});
