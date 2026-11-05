import { TEST_ENV } from './test-env';

// Valores fijos para las pruebas e2e; tienen prioridad sobre el archivo .env.
Object.assign(process.env, TEST_ENV);
