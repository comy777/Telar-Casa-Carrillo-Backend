import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
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
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
  });
});
