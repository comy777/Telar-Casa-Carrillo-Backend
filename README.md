# Telar Casa Carrillo — Backend

API de la tienda en línea Telar Casa Carrillo: NestJS 11, PostgreSQL 16 y Prisma 6, organizada con Clean Architecture por módulos.

Estado: **Fases 1 (fundaciones), 2 (identidad y administración), 3 (catálogo) y 4 (carrito e inventario)** del [plan de implementación](docs/implementation-plan.md).

## Requisitos
- Node.js 22 o superior (ver `.nvmrc`)
- PostgreSQL 16 o superior: con Docker (`docker-compose.yml`) o instalado localmente

## Puesta en marcha
1. Instalar dependencias (genera también el cliente Prisma):
   ```bash
   npm install
   ```
2. Copiar `.env.example` a `.env` y ajustar valores locales. Generar un `JWT_ACCESS_SECRET` propio:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
3. Preparar PostgreSQL, con una de estas dos opciones:
   - **Docker:** `npm run db:up`
   - **PostgreSQL instalado en Windows:** crear el usuario y la base de datos una sola vez, con `psql` como superusuario. Usa la misma contraseña que pusiste en `DATABASE_URL`:
     ```sql
     CREATE ROLE telar_app WITH LOGIN PASSWORD 'change_this_local_password' CREATEDB;
     CREATE DATABASE telar_casa_carrillo OWNER telar_app;
     ```
     `CREATEDB` lo necesitan `prisma migrate dev` (base temporal) y las pruebas e2e (`telar_casa_carrillo_test`).
4. Aplicar las migraciones y crear los roles y permisos:
   ```bash
   npm run db:migrate
   ```
   ```bash
   npm run db:seed
   ```
   Al crear migraciones nuevas, revisar el SQL antes de aplicarlo (`npm run db:migrate:create -- --name <nombre>`). Si Prisma intenta borrar los índices parciales o el de búsqueda, quitar esas líneas.
5. Arrancar en modo desarrollo:
   ```bash
   npm run start:dev
   ```
6. Crear el primer administrador: registrarse por la API (o el storefront), confirmar el correo y luego:
   ```bash
   npm run admin:grant -- tu-correo@ejemplo.com admin
   ```

Sin `SMTP_HOST` (solo fuera de producción) los correos se escriben en el log de la API, con el enlace de verificación o recuperación listo para copiar.

- Salud: http://localhost:3001/api/health
- Documentación OpenAPI: http://localhost:3001/api/docs (JSON en `/api/docs-json`; desactivada en producción)
- Las rutas de negocio van bajo `/api/v1/...`.

## Autenticación
| Ruta | Qué hace |
|---|---|
| `POST /api/v1/auth/register` | Crea la cuenta (pendiente) y envía el correo de verificación |
| `POST /api/v1/auth/verify-email` | Confirma el correo con `{ token }` |
| `POST /api/v1/auth/resend-verification` | Reenvía la verificación |
| `POST /api/v1/auth/login` | Devuelve `accessToken` (15 min) y deja el refresh token en una cookie `HttpOnly` |
| `POST /api/v1/auth/refresh` | Nuevo `accessToken`; rota la cookie |
| `POST /api/v1/auth/logout` | Cierra la sesión |
| `POST /api/v1/auth/forgot-password` | Envía el enlace de recuperación |
| `POST /api/v1/auth/reset-password` | Cambia la contraseña con `{ token, password }` y cierra todas las sesiones |
| `GET /api/v1/auth/me` | Usuario, roles y permisos |

Para el frontend:
- Enviar el access token en `Authorization: Bearer <token>` y guardarlo solo en memoria.
- Llamar a `/auth/refresh` con `credentials: 'include'` al cargar la página y cuando el token venza.
- La cookie es `SameSite=Strict` y solo se envía a `/api/v1/auth`: storefront y API deben estar en el mismo sitio (p. ej. `tienda.com` y `api.tienda.com`).
- Los enlaces de los correos apuntan a `STOREFRONT_URL` + `/cuenta/verificar-correo?token=…` y `/cuenta/restablecer-contrasena?token=…`.

Toda ruta exige access token salvo las marcadas como públicas. La administración (`/api/v1/admin/...`) exige además permisos: `users:read`, `users:manage`, `roles:read`, `audit:read`, `catalog:read` y `catalog:manage`. Los permisos y roles se definen en `src/modules/identity/domain/permissions.ts` y se sincronizan con `npm run db:seed` (ejecutarlo después de actualizar).

## Catálogo
Tienda (públicas, con `Cache-Control` de 60 s):

| Ruta | Qué hace |
|---|---|
| `GET /api/v1/catalog/products` | Busca (`q`) y filtra (`category`, `artisan`, `material`, `minPrice`, `maxPrice`, `featured`); ordena con `sort` = `relevance`, `newest`, `price_asc`, `price_desc` |
| `GET /api/v1/catalog/products/:slug` | Detalle con variantes activas, galería, artesano y `seo` listo para las metaetiquetas |
| `GET /api/v1/catalog/categories` | Árbol de categorías visibles |
| `GET /api/v1/catalog/categories/:slug` | Categoría con migas de pan y subcategorías |
| `GET /api/v1/catalog/artisans`, `/artisans/:slug` | Artesanos activos (sus productos: `/products?artisan=`) |
| `GET /api/v1/catalog/materials` | Materiales para el filtro |
| `GET /api/v1/catalog/sitemap` | Slugs publicados para `sitemap.xml` |

Administración: `/api/v1/admin/products` (con `/:id/status`, `/:id/variants` y `/:id/images`), `/api/v1/admin/categories` y `/api/v1/admin/artisans`. Detalle en `/api/docs`.

- Los precios van en pesos con IVA incluido; internamente se manejan en centavos enteros.
- Un producto se crea en `DRAFT`; para publicarlo (`PATCH /:id/status` con `ACTIVE`) necesita una variante activa y una imagen. Las variantes no se borran, se desactivan.
- Las imágenes se suben como `multipart/form-data` en el campo `file` (JPEG, PNG o WebP, máx. 5 MB). Sin Cloudinary configurado, en desarrollo quedan en `uploads/` y la API las sirve en `/media/...`.

## Scripts
| Script | Qué hace |
|---|---|
| `start:dev` | API con recarga automática |
| `build` / `start` | Compila a `dist/` y ejecuta la versión compilada |
| `lint`, `format`, `typecheck` | Calidad de código |
| `test`, `test:cov` | Pruebas unitarias y cobertura |
| `test:e2e` | Pruebas e2e contra PostgreSQL real, en la base `telar_casa_carrillo_test` (se crea sola; `TEST_DATABASE_URL` la cambia) |
| `db:up`, `db:migrate`, `db:migrate:create`, `db:migrate:deploy`, `db:studio` | Base de datos |
| `db:seed` | Sincroniza roles y permisos (idempotente; ejecutar en cada despliegue) |
| `admin:grant -- <correo> [rol]` | Asigna un rol a un usuario existente |
| `prisma:validate`, `prisma:generate` | Validar el esquema / regenerar el cliente |

## Carrito e inventario
| Ruta | Qué hace |
|---|---|
| `GET /api/v1/cart` | Carrito con precios y disponibilidad revalidados (`lines[].issues`, `canCheckout`) |
| `POST /api/v1/cart/items` | Agrega `{ variantId, quantity }` |
| `PATCH` / `DELETE /api/v1/cart/items/:variantId` | Cambia la cantidad o quita la línea |
| `DELETE /api/v1/cart` | Vacía el carrito |
| `POST /api/v1/cart/reservation` | Inicia el checkout: aparta el stock por `CHECKOUT_RESERVATION_MINUTES` |
| `DELETE /api/v1/cart/reservation` | Abandona el checkout y devuelve el stock |

- Funciona con o sin sesión. Sin sesión, el carrito va en la cookie HttpOnly `tcc_cart`; el frontend debe llamar con `credentials: 'include'`. Al iniciar sesión, el carrito de invitado se incorpora al de la cuenta en la siguiente petición.
- Agregar al carrito no aparta stock; solo la reserva del checkout lo hace, y cualquier cambio al carrito la libera.
- Administración: `/api/v1/admin/inventory` (permisos `inventory:read` e `inventory:manage`) con entradas (`/:variantId/receipts`), conteos físicos (`/:variantId/count`), umbral y movimientos.

## Convenciones ya implementadas
- **Configuración:** las variables de entorno se validan con Zod al arrancar (`src/shared/config/env.schema.ts`). En producción además se exige SMTP, HTTPS en la tienda y un secreto JWT que no sea el de ejemplo.
- **Errores:** todas las respuestas de error usan `application/problem+json` (RFC 9457) con un `code` estable. Los errores de dominio se traducen a 401, 403, 404, 409 y 422. Los errores inesperados devuelven 500 sin detalles internos.
- **Logs:** JSON con pino, `x-request-id` por petición y ocultamiento de contraseñas, tokens y cookies.
- **Seguridad HTTP:** Helmet, CORS por lista de orígenes, límite de 1 MB en el cuerpo, límite de peticiones global (120/min) y estricto en login, registro y recuperación (5/min), y `ValidationPipe` que rechaza campos no declarados.
- **Contraseñas:** Argon2id (parámetros OWASP), mínimo 10 caracteres sin reglas de símbolos. El login calcula el hash aunque el correo no exista, para no revelar por el tiempo de respuesta qué cuentas existen.
- **Auditoría:** el puerto `AUDIT_TRAIL` está disponible en todos los módulos; registro, inicio de sesión (exitoso y fallido), verificación, recuperación, reutilización de sesión y acciones de administración ya quedan registrados.
- **Transacciones:** los casos de uso dependen del puerto `UnitOfWork`. Los repositorios Prisma usan `PrismaClientProvider.client`, que devuelve la transacción activa cuando la hay.
- **Webhooks:** `rawBody` está activo para poder verificar firmas de las pasarelas.
- **Imágenes:** el puerto `IMAGE_STORAGE` (Cloudinary o disco) está disponible en todos los módulos. En producción se exige Cloudinary.

## Documentación
- [Arquitectura](docs/architecture.md)
- [Modelo de dominio](docs/domain-model.md)
- [Plan de implementación](docs/implementation-plan.md)
