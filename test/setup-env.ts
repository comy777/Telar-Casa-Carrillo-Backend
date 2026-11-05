// Valores fijos para las pruebas e2e; tienen prioridad sobre el archivo .env.
// La base de datos se reemplaza por un doble en cada prueba, así que no se conecta.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?schema=public';
process.env.CORS_ORIGINS = 'http://localhost:3000';
