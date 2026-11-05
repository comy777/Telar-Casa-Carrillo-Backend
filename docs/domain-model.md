# Modelo de dominio inicial

## Agregados y responsabilidades

| Agregado | Raíz | Responsabilidad / invariantes |
|---|---|---|
| Identity | User | Identidad, estado, roles, credenciales, tokens y consentimientos |
| Catalog | Product | Publicación, datos comerciales, variantes, imágenes y categorías. Todo producto tiene al menos una variante |
| Artisan | Artisan | Perfil, historia y estado del creador |
| Inventory | Inventory (una por variante) | Existencias, reservas y movimientos; `reservado <= disponible` |
| Cart | Cart | Líneas, cantidades y propietario (usuario o invitado) |
| Promotions | Coupon | Vigencia, límites globales y por cliente, usos registrados |
| Ordering | Order | Snapshot de precios/dirección/cliente, transiciones válidas y factura electrónica |
| Payments | Payment | Intentos, estado confirmado por proveedor y reembolsos (totales o parciales) |
| Shipping | Shipment | Método, guía y eventos de seguimiento |
| Content | Page, Banner, Testimonial, Faq | Publicación y orden de contenido |

## Reglas de negocio críticas
1. El precio se calcula en servidor; nunca confiar en totales enviados por el navegador.
2. `OrderItem` conserva nombre, SKU, variante, precio unitario, cantidad y descuentos históricos.
3. El checkout revalida precio, estado de publicación, cupón y disponibilidad.
4. La reserva de inventario es atómica, tiene expiración y se crea **al iniciar el checkout**, no al agregar al carrito (evita bloquear stock con carritos abandonados). Un proceso programado libera las vencidas.
5. El pago solo se considera confirmado después de verificar la notificación del proveedor o consultar su API.
6. Toda notificación se guarda primero en `WebhookEvent`; se procesa de forma idempotente usando `(provider, providerEventId)`.
7. La transición de pedido se valida en el dominio; no aceptar cualquier estado arbitrario. Cada cambio queda en `OrderStatusHistory` con su autor (o nulo si fue el sistema).
8. Un reembolso no borra ni altera el historial original del pago. Se admiten reembolsos parciales; la suma de reembolsos aprobados no puede superar el monto pagado.
9. Los cambios administrativos relevantes generan auditoría.
10. La moneda se guarda explícitamente; no mezclar monedas en un mismo pedido.
11. El uso de un cupón se registra en `CouponRedemption` dentro de la misma transacción que crea el pedido, bloqueando el cupón para respetar `usageLimit` y `perCustomerLimit` con compras simultáneas.
12. Los montos se guardan como `Decimal` en pesos. Al hablar con la pasarela se convierten al formato que pida (Wompi usa centavos enteros: `amount_in_cents`).
13. `orderNumber` se genera con una secuencia de PostgreSQL, no en el cliente.

## Estados sugeridos
- Order: `PENDING_PAYMENT`, `PAID`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `REFUNDED`. Un reembolso parcial no cambia el estado del pedido (el pedido sigue su flujo de envío); se ve en el pago.
- Payment: `PENDING`, `APPROVED`, `DECLINED`, `VOIDED`, `PARTIALLY_REFUNDED`, `REFUNDED`, `ERROR`.
- Refund: `PENDING`, `APPROVED`, `FAILED`.
- Shipment: `PENDING`, `READY`, `IN_TRANSIT`, `DELIVERED`, `FAILED`, `RETURNED`. Los eventos de seguimiento usan el mismo enum; el texto original de la transportadora va en `carrierStatus`.

Los estados finales y sus transiciones deben implementarse como reglas explícitas, no como strings libres.

### Transiciones de pedido permitidas
| Desde | Hacia |
|---|---|
| `PENDING_PAYMENT` | `PAID`, `CANCELLED` (pago rechazado, expirado o cancelado por el cliente) |
| `PAID` | `PROCESSING`, `CANCELLED` (con reembolso total) |
| `PROCESSING` | `SHIPPED`, `CANCELLED` (con reembolso total) |
| `SHIPPED` | `DELIVERED`, `REFUNDED` (devolución en tránsito) |
| `DELIVERED` | `REFUNDED` (retracto o devolución total) |
| `CANCELLED`, `REFUNDED` | ninguno (finales) |

Validar esta tabla con el negocio en la Fase 0.

## Colombia: datos que el modelo debe soportar
- **Factura electrónica (DIAN):** el pedido guarda tipo/número de documento del comprador, número de factura y CUFE. La emisión se hace a través de un proveedor tecnológico, detrás de un puerto `ElectronicInvoiceIssuer`.
- **IVA:** cada producto tiene `taxRate`. Definir en `StoreSetting` si los precios publicados incluyen IVA (lo habitual en venta al consumidor).
- **Habeas data (Ley 1581 de 2012):** se guarda cuándo y qué versión de la política de tratamiento de datos aceptó el usuario.
- **Estatuto del Consumidor (Ley 1480 de 2011):** el derecho de retracto y la reversión del pago en ventas a distancia se modelan como reembolsos (`Refund`) con su motivo.
- **Direcciones:** se guarda el código DANE del municipio para integrarse con transportadoras.

Confirmar estos puntos con un contador o abogado; el modelo solo deja el espacio para cumplirlos.

## Restricciones SQL complementarias
Prisma no representa todas las restricciones CHECK ni los índices parciales de PostgreSQL en el schema. Están en [`prisma/sql/constraints.sql`](../prisma/sql/constraints.sql) e incluyen, entre otras:
- Cantidades no negativas o positivas en inventario, reservas, carrito y pedidos; `quantityReserved <= quantityOnHand`.
- Montos positivos en pagos y reembolsos; totales del pedido no negativos.
- `compareAtPrice > price`, porcentaje de cupón `<= 100`, `rating` entre 1 y 5.
- Carrito con usuario o `guestKey`; reserva activa con carrito o pedido.
- Una sola dirección por defecto por usuario y una sola imagen principal por producto.
- Índice de búsqueda de texto en español sobre el nombre y la descripción del producto.

Probarlas en pruebas de integración.
