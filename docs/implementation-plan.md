# Plan de implementación y Definition of Done

## Fase 0 — Confirmación de negocio
- Confirmar marca propia vs marketplace. **Si es marketplace**, el modelo actual no alcanza: faltan comisiones, liquidaciones a artesanos, datos bancarios/tributarios del artesano y pagos divididos. Decidirlo antes de crear migraciones.
- ~~Decidir monorepo o dos repositorios~~ → dos repositorios, nombre "Telar Casa Carrillo" (ver `architecture.md`).
- Confirmar Colombia solamente o venta internacional.
- Confirmar uno o varios administradores.
- Definir quién factura, prepara y despacha.
- Confirmar con el contador: obligación de facturación electrónica DIAN, proveedor tecnológico de facturación, tarifas de IVA por producto y si los precios se publican con IVA incluido.
- Definir políticas de privacidad y tratamiento de datos (Ley 1581 de 2012), términos y condiciones, cambios, devoluciones y garantías.
- Definir cómo se atienden el derecho de retracto y la reversión del pago (Ley 1480 de 2011, ventas a distancia).
- Validar la tabla de transiciones de pedido de `domain-model.md`.
- Definir proveedor de pagos y logística.

## Fase 1 — Fundaciones
- [x] Crear el repositorio backend y configuración TypeScript estricta.
- [x] Configurar lint (con reglas de capas), format, tests unitarios/e2e y CI.
- [x] Configurar PostgreSQL (Docker) y Prisma 6.
- [x] Generar y aplicar la primera migración (`20261105161617_init`) incluyendo `prisma/sql/constraints.sql`.
- [x] Generar `package-lock.json` (versionarlo: la CI usa `npm ci`).
- [x] Configurar procesos programados (`@nestjs/schedule`, Fase 4; `JOBS_ENABLED` los apaga).
- [x] Publicar OpenAPI desde NestJS (`/api/docs`).
- [x] Definir manejo de errores (problem+json) y logging (pino con request id y ocultamiento de secretos).

## Fase 2 — Identidad y administración
- [x] Registro/login, recuperación y verificación de correo (`UserToken`, guardando solo el hash).
- [x] Aceptación registrada de términos y política de datos (fecha y versión).
- [x] Refresh tokens con rotación y revocación de la familia si se reutiliza uno.
- [x] Roles/permisos en servidor, leídos en cada petición (suspender o quitar un rol surte efecto de inmediato).
- [x] Auditoría de cambios (`/admin/audit-logs`).
- [x] Administración protegida: listar/buscar usuarios, suspender/reactivar, asignar roles, ver roles.
- [ ] Pendiente para el frontend: páginas `/cuenta/verificar-correo` y `/cuenta/restablecer-contrasena` del storefront, que leen `?token=` y lo envían a la API.
- [ ] Pendiente para producción: configurar SMTP real y revisar las plantillas de correo con el negocio.

## Fase 3 — Catálogo
- [x] Productos con variantes (las variantes no se borran, se desactivan), categorías en árbol de hasta 3 niveles, artesanos, materiales y galería de imágenes con una principal.
- [x] Estados `DRAFT` → `ACTIVE` → `ARCHIVED` con transiciones explícitas; publicar exige una variante activa y una imagen.
- [x] Carga de imágenes a Cloudinary (subida firmada, sin SDK) o a disco en desarrollo; el tipo se valida por el contenido del archivo (JPEG, PNG, WebP; máx. 5 MB) y los archivos reemplazados o quitados se borran.
- [x] Búsqueda de texto en español (índice GIN), filtros por categoría (con subcategorías), artesano, material, precio y destacados; orden por relevancia, novedad y precio; paginación.
- [x] SEO: título, descripción e imagen listos para las metaetiquetas, y `/catalog/sitemap` para generar `sitemap.xml`.
- [x] Solo lo publicado aparece en la tienda: una categoría o un artesano inactivos se ocultan (y la categoría oculta su rama).
- [x] Permisos `catalog:read` y `catalog:manage`; todos los cambios quedan en auditoría.
- [ ] Pendiente: la búsqueda no ignora tildes ("artesania" no encuentra "artesanía"). Se resuelve con la extensión `unaccent` cuando el catálogo lo justifique.
- [x] Disponibilidad por variante en la tienda (Fase 4).

## Fase 4 — Carrito e inventario
- [x] Carrito persistente para usuario y para invitado (cookie HttpOnly con clave aleatoria; en la base solo su hash). Al iniciar sesión, el de invitado se incorpora al de la cuenta.
- [x] Revalidación en servidor en cada lectura: precio actual, producto publicado y unidades disponibles por línea.
- [x] Inventario por variante con libro de movimientos (saldo tras cada movimiento): entradas, conteos físicos con motivo y umbral de "últimas unidades".
- [x] Reservas al iniciar el checkout (`POST /cart/reservation`), todo o nada, con vencimiento (`CHECKOUT_RESERVATION_MINUTES`) y actualización condicional en la base para no vender de más. Cambiar el carrito libera la reserva.
- [x] Procesos programados (`@nestjs/schedule`): liberar reservas vencidas cada minuto y borrar carritos de invitado vencidos cada hora; seguros con varias instancias.
- [x] Pruebas de sobreventa (8 checkouts por 3 unidades), liberación única con dos procesos simultáneos y todo o nada.
- [x] La tienda muestra la disponibilidad (`availability`) y filtra con `inStock=true`.

## Fase 5 — Pedidos y checkout
- [x] Direcciones en Colombia con código DANE (el departamento se deduce de él) y libreta de direcciones del cliente (`/account/addresses`).
- [x] Métodos de envío con costo base y envío gratis desde un subtotal (`/shipping/methods`; administración en `/admin/shipping-methods`).
- [x] Datos del comprador para facturación: tipo y número de documento. Sin ellos, la factura va a consumidor final.
- [x] IVA incluido en los precios y desglosado por línea, también el del envío (`SHIPPING_TAX_RATE`).
- [x] Cupones de porcentaje (con tope) o de monto fijo, con vigencia, mínimo, límite global y límite por cliente. El cupón se bloquea (`FOR UPDATE`) y su uso se registra en la misma transacción que crea el pedido.
- [x] Snapshot de productos, cliente y dirección en el pedido.
- [x] Creación transaccional del pedido (`POST /checkout/orders`):
  - Revalida el carrito.
  - Aparta el stock hasta el plazo de pago (`ORDER_PAYMENT_MINUTES`).
  - Toma el número `TCC-000123` de una secuencia de PostgreSQL.
  - Vacía el carrito y envía la confirmación.
  - Antes de confirmar, `POST /checkout/quote` muestra los totales.
- [x] Los pedidos sin pagar que vencen se cancelan solos y devuelven el stock y el uso del cupón.
- [x] Consulta de pedidos con sesión (`/account/orders`) o como invitado, con el token del correo (`/orders/:numero?token=`).
- [x] Administración (`/admin/orders`): filtros, avance de estados según la tabla de transiciones y registro manual de la factura.
- [x] Puerto `ElectronicInvoiceIssuer`. Sin proveedor configurado, la factura queda pendiente para registrarla a mano (filtro `invoicePending`).
- [ ] Pendiente: el adaptador del proveedor tecnológico de facturación, cuando se contrate (Fase 0).

## Fase 6 — Pagos
- [x] Wompi (Colombia) por su API REST, verificado contra docs.wompi.co. Sandbox por defecto; las llaves se validan contra el ambiente de la URL.
- [x] El pago se inicia desde el backend (`POST /orders/:numero/payments`): Web Checkout y Widget con la firma de integridad (incluye la expiración igual al plazo de pago del pedido).
- [x] Cada evento se guarda en `WebhookEvent` antes de procesarlo, con su firma verificada (checksum SHA-256 de `signature.properties` + `timestamp` + secreto).
- [x] Firma inválida: el evento se guarda y se responde 401. Un fallo al procesar responde 500 para que Wompi reintente.
- [x] Idempotencia: el mismo evento no se procesa dos veces, y los estados del pago solo avanzan.
- [x] Conciliación cada 5 minutos de los pagos pendientes, consultando la transacción con la llave privada.
- [x] Un pedido con un pago en curso (p. ej. PSE) no se cancela al vencer.
- [x] Reembolsos totales y parciales por la API de Wompi, con `Idempotency-Key`:
  - La suma nunca supera lo pagado.
  - El reembolso total cancela el pedido, o lo deja `REFUNDED` si ya se envió, y puede devolver el stock.
  - Los que quedan en curso se confirman a mano.
- [x] Nunca se marca pagado desde el navegador: al volver de la pasarela (`/payments/confirm`) se consulta la transacción a Wompi.
- [x] Revisión de pagos anómalos (`needsReview`): pago tardío de un pedido vencido, monto distinto, pago duplicado y falta de stock.
- [ ] Pendiente: probar en el sandbox real de Wompi con las llaves `pub_test_`/`prv_test_` y configurar la URL de eventos en el panel de Wompi. Las pruebas automáticas usan el adaptador real contra una API simulada.
- [ ] Pendiente si se requiere: Mercado Pago (las variables siguen en `.env.example`, pero no hay adaptador).

## Fase 7 — Experiencia y operación
- Seguimiento de pedidos.
- Notificaciones por correo.
- Panel de métricas.
- Exportaciones y reportes.
- Monitoreo y alertas.

## Fase 8 — Producción
- Pruebas E2E del recorrido completo.
- Revisión de seguridad y privacidad.
- Backups y restauración probada.
- Variables/secretos en gestor seguro.
- Observabilidad, dominio, HTTPS y despliegue.
- Prueba de compra real de bajo valor y reembolso controlado.

## Definition of Done por módulo
- Reglas de dominio probadas.
- Casos de uso sin dependencia de frameworks.
- Adaptadores con pruebas de integración.
- API documentada.
- Autorización verificada en backend.
- Errores y logs controlados.
- Migración revisada.
- Sin TODOs ni mocks en rutas de producción.
