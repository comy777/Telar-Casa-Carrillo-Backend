/** Carga .env si existe (en producción las variables vienen del entorno). */
try {
  process.loadEnvFile();
} catch {
  // Sin .env: se usan las variables ya definidas.
}
