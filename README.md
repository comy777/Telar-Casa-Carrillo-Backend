# Telar Casa Carrillo — Backend

API de la tienda en línea Telar Casa Carrillo: NestJS 11, PostgreSQL 16 y Prisma 6, organizada con Clean Architecture por módulos.

Estado: **Fase 1 (fundaciones)** del [plan de implementación](docs/implementation-plan.md).

## Requisitos
- Node.js 22 o superior (ver `.nvmrc`)
- PostgreSQL 16 o superior: con Docker (`docker-compose.yml`) o instalado localmente

## Puesta en marcha
1. Instalar dependencias (genera también el cliente Prisma):
   ```bash
   npm install
   ```
2. Copiar `.env.example` a `.env` y ajustar valores locales.
3. Preparar PostgreSQL, con una de estas dos opciones:
   - **Docker:** `npm run db:up`
   - **PostgreSQL instalado en Windows:** crear el usuario y la base de datos una sola vez, con `psql` como superusuario. Usa la misma contraseña que pusiste en `DATABASE_URL`:
     ```sql
     CREATE ROLE telar_app WITH LOGIN PASSWORD 'change_this_local_password' CREATEDB;
     CREATE DATABASE telar_casa_carrillo OWNER telar_app;
     ```
     `CREATEDB` lo necesita `prisma migrate dev` para su base de datos temporal (shadow database).
4. Aplicar las migraciones (la inicial ya incluye `prisma/sql/constraints.sql`):
   ```bash
   npm run db:migrate
   ```
   Al crear migraciones nuevas, revisar el SQL antes de aplicarlo (`npm run db:migrate:create -- --name <nombre>`). Si Prisma intenta borrar los índices parciales o el de búsqueda, quitar esas líneas.
5. Arrancar en modo desarrollo:
   ```bash
   npm run start:dev
   ```

- Salud: http://localhost:3001/api/health
- Documentación OpenAPI: http://localhost:3001/api/docs (JSON en `/api/docs-json`; desactivada en producción)
- Las rutas de negocio van bajo `/api/v1/...`.

## Scripts
| Script | Qué hace |
|---|---|
| `start:dev` | API con recarga automática |
| `build` / `start` | Compila a `dist/` y ejecuta la versión compilada |
| `lint`, `format`, `typecheck` | Calidad de código |
| `test`, `test:e2e`, `test:cov` | Pruebas unitarias, e2e y cobertura |
| `prisma:validate`, `prisma:generate` | Validar el esquema / regenerar el cliente |
| `db:up`, `db:migrate`, `db:migrate:create`, `db:migrate:deploy`, `db:studio` | Base de datos |

## Convenciones ya implementadas
- **Configuración:** las variables de entorno se validan con Zod al arrancar (`src/shared/config/env.schema.ts`). Cada módulo nuevo agrega allí las suyas.
- **Errores:** todas las respuestas de error usan `application/problem+json` (RFC 9457). Los errores de dominio (`NotFoundError`, `ConflictError`, `BusinessRuleViolation`) se traducen a 404, 409 y 422. Los errores inesperados devuelven 500 sin detalles internos.
- **Logs:** JSON con pino, `x-request-id` por petición y ocultamiento de contraseñas, tokens y cookies.
- **Seguridad HTTP:** Helmet, CORS por lista de orígenes, límite de 1 MB en el cuerpo, límite de peticiones global y `ValidationPipe` que rechaza campos no declarados.
- **Transacciones:** los casos de uso dependen del puerto `UnitOfWork`. Los repositorios Prisma usan `PrismaClientProvider.client`, que devuelve la transacción activa cuando la hay.
- **Webhooks:** `rawBody` está activo para poder verificar firmas de las pasarelas.

## Documentación
- [Arquitectura](docs/architecture.md)
- [Modelo de dominio](docs/domain-model.md)
- [Plan de implementación](docs/implementation-plan.md)
