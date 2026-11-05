# Despliegue

La API es una imagen Docker sin estado (`Dockerfile`) más una base PostgreSQL 16+ administrada. Sirve en cualquier plataforma de contenedores (Render, Railway, Fly.io, Google Cloud Run, AWS ECS o una VM con Docker).

## Piezas
| Pieza | Recomendación |
|---|---|
| API | 1 instancia al inicio (2 si se quiere alta disponibilidad). Los procesos programados son seguros con varias instancias. |
| PostgreSQL | Servicio administrado con respaldos automáticos y PITR (Neon, Supabase, RDS, Cloud SQL). Región cercana a Colombia (p. ej. `us-east`, `sa-east-1`). |
| Imágenes | Cloudinary (obligatorio en producción). |
| Pagos | Wompi producción (llaves `pub_prod_`, `prv_prod_`, `prod_events_`, `prod_integrity_`). |
| Correo | SMTP transaccional (Amazon SES, Postmark, Brevo…) con SPF, DKIM y DMARC del dominio. |
| Dominio y HTTPS | `api.<dominio>` para la API y `<dominio>` para la tienda: deben ser del mismo sitio por la cookie `SameSite=Strict` de sesión. HTTPS lo pone la plataforma o un proxy (Caddy, Cloudflare). |

## Variables de entorno
Todas están documentadas en `.env.example`. La API se niega a arrancar en producción si falta algo esencial:
- CORS
- un `JWT_ACCESS_SECRET` real
- SMTP
- Cloudinary
- las cuatro llaves de Wompi del ambiente correcto
- `STOREFRONT_URL` con HTTPS

Además:
- `TRUST_PROXY`: número de proxies delante de la API (normalmente `1`). Si no se configura, el límite de peticiones y la auditoría ven la IP del proxy.
- `ADMIN_ALERT_EMAILS`: correos que reciben pedidos pagados y alertas.
- `LOG_LEVEL=info`.

### Secretos
No poner secretos en el repositorio ni en la imagen. Dos opciones:
1. **Gestor de secretos de la plataforma** (Render/Railway/Fly secrets, GCP Secret Manager, AWS Secrets Manager), expuesto como variables de entorno.
2. **Archivos montados**: cualquier variable acepta la forma `NOMBRE_FILE=/ruta`, por ejemplo `WOMPI_PRIVATE_KEY_FILE=/run/secrets/wompi_private`. La API lee el archivo al arrancar.

Para generar el `JWT_ACCESS_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Rotarlo cierra todas las sesiones activas: los access tokens dejan de validar y los clientes deben volver a iniciar sesión.

## Pasos de cada despliegue
1. Construir la imagen (la CI lo hace en cada cambio):

   ```bash
   docker build -t telar-api:<versión> .
   ```

2. Ejecutar la fase de release **con la misma imagen y las mismas variables** antes de arrancar la nueva versión. Aplica las migraciones pendientes y sincroniza los roles y permisos:

   ```bash
   docker run --rm --env-file prod.env telar-api:<versión> npm run release
   ```

3. Arrancar la nueva versión. El `HEALTHCHECK` de la imagen consulta `/api/health`.

4. Comprobar `GET /api/health` y, con un token de administrador, `GET /api/v1/admin/system/status` (`healthy: true`).

Las migraciones son aditivas. Si una futura migración no lo es, hacer el cambio en dos despliegues: primero agregar y luego, en el siguiente despliegue, quitar lo viejo.

## Primera puesta en marcha
1. Crear la base y el usuario de la aplicación (sin permisos de superusuario).
2. Ejecutar `npm run release`.
3. Registrar la cuenta del administrador desde la tienda, confirmar el correo y otorgarle el rol:

   ```bash
   docker run --rm --env-file prod.env telar-api:<versión> npx tsx scripts/grant-role.ts correo@dominio admin
   ```

4. En el panel de Wompi (producción), configurar la URL de eventos:
   `https://api.<dominio>/api/v1/payments/webhooks/wompi`
5. Crear los métodos de envío, el catálogo y las existencias desde el panel de administración.
6. Recorrer `docs/go-live-checklist.md`.

## Rendimiento y escala
- Cada instancia mantiene un pool de conexiones de Prisma. Con varias instancias o con un plan pequeño de base de datos, limitarlo con `?connection_limit=5` en `DATABASE_URL`, o usar el pooler del proveedor.
- El bus de eventos de notificaciones es en memoria (ver `operations.md`). Con varias instancias cada una envía sus propios correos, sin duplicarlos.
