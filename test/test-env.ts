/**
 * Entorno de las pruebas e2e. Usan una base de datos propia
 * (`telar_casa_carrillo_test`) que se recrea al empezar: nunca la de desarrollo.
 * En CI se define TEST_DATABASE_URL.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://telar_app:change_this_local_password@localhost:5432/telar_casa_carrillo_test?schema=public';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DATABASE_URL,
  CORS_ORIGINS: 'http://localhost:3000',
  STOREFRONT_URL: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'e2e-test-secret-with-at-least-32-characters',
  SMTP_HOST: '',
};
