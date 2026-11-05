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
  ])('en producción rechaza %s = "%s"', (key, value) => {
    expect(() => validateEnv({ ...production, [key]: value })).toThrow(new RegExp(key));
  });
});
