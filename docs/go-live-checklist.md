# Lista de salida a producción

Marcar cada punto antes de abrir la tienda al público. Los que dicen **(negocio)** no son técnicos y bloquean el lanzamiento.

## Decisiones de negocio (Fase 0)
- [ ] **(negocio)** Marca propia o marketplace. El modelo actual es de **marca propia**: un marketplace necesita comisiones, liquidaciones y pagos divididos.
- [ ] **(negocio)** Con el contador:
  - obligación de facturación electrónica y proveedor tecnológico;
  - tarifas de IVA por producto, y si el envío lleva IVA (`SHIPPING_TAX_RATE`);
  - plazo de conservación de pedidos y facturas.
- [ ] **(negocio)** Política de tratamiento de datos (Ley 1581), términos y condiciones, cambios, devoluciones, garantías y derecho de retracto (Ley 1480), publicadas en el storefront. Actualizar `PRIVACY_POLICY_VERSION` cuando cambien.
- [ ] **(negocio)** Validar la tabla de transiciones de pedido (`docs/domain-model.md`) y los plazos: pago (`ORDER_PAYMENT_MINUTES`) y reserva de checkout.
- [ ] **(negocio)** Transportadoras, cobertura y costos de envío.

## Infraestructura
- [ ] Base PostgreSQL administrada con respaldos diarios, PITR y región cercana.
- [ ] Respaldo lógico diario fuera del proveedor y primer simulacro con `npm run db:restore-check` (ver `operations.md`).
- [ ] Secretos en el gestor de la plataforma. Nada en el repositorio ni en la imagen.
- [ ] Dominio, HTTPS y `api.<dominio>` en el mismo sitio que la tienda. `TRUST_PROXY` configurado.
- [ ] SMTP transaccional con SPF, DKIM y DMARC. Enviar un correo de prueba.
- [ ] Cloudinary de producción.
- [ ] `ADMIN_ALERT_EMAILS` con al menos dos personas.
- [ ] Monitores externos de `/api/health` y `/api/v1/admin/system/status`, y alertas de 5xx en los logs.

## Pagos (Wompi)
- [ ] Probar en **sandbox** con las llaves de prueba:
  - [ ] Tarjeta aprobada `4242 4242 4242 4242` y rechazada `4111 1111 1111 1111`.
  - [ ] Nequi `3991111111` y `3992222222`.
  - [ ] PSE con el banco que aprueba y el que rechaza.
  - [ ] Que lleguen los eventos y la conciliación.
  - [ ] Un reembolso.
- [ ] Llaves de producción cargadas, con la URL `https://production.wompi.co/v1`.
- [ ] URL de eventos de producción configurada en el panel de Wompi (`/api/v1/payments/webhooks/wompi`).
- [ ] **Compra real de bajo valor** con una tarjeta propia, siguiendo el recorrido completo:
  - [ ] Catálogo, carrito y checkout.
  - [ ] Pago y confirmación del pedido.
  - [ ] Correo de confirmación.
  - [ ] Factura.
  - [ ] Despacho y seguimiento.
  - [ ] Entrega.
- [ ] **Reembolso controlado** de esa compra: llega a la tarjeta, el pedido queda cancelado o devuelto y el stock vuelve si se pidió.

## Datos iniciales
- [ ] `npm run release` (migraciones, roles y permisos).
- [ ] Administrador creado con `scripts/grant-role.ts`.
- [ ] Métodos de envío, artesanos, categorías, productos con fotos y existencias reales.
- [ ] Revisar el catálogo publicado desde la tienda: precios con IVA, fotos, disponibilidad y SEO.

## Seguridad
- [ ] Repasar `docs/security.md`, sobre todo los riesgos aceptados.
- [ ] Prueba de penetración o revisión externa (recomendado).
- [ ] El storefront usa `credentials: 'include'`, guarda el access token solo en memoria y envía el token de invitado en `X-Order-Token`.
