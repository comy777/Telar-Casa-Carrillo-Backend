# Operación

## Respaldos y restauración
Objetivo: perder como máximo **24 horas** de datos (RPO) y volver a operar en menos de **4 horas** (RTO). Ajustar con el negocio.

1. **Respaldos del proveedor**: activar los respaldos diarios y la recuperación a un punto en el tiempo (PITR) del PostgreSQL administrado, con al menos 7 días de retención.
2. **Respaldo lógico propio, diario y fuera del proveedor de la base**:

   ```bash
   npm run db:backup -- /ruta/de/respaldos
   ```

   El script genera un `pg_dump` en formato custom. Copiar el archivo a otro proveedor (un bucket con versionado y cifrado) y retenerlo 30 días, más uno por mes durante un año. Los respaldos contienen datos personales: deben tener acceso restringido y cifrado.
3. **Simulacro de restauración mensual** (y después de cada cambio grande de esquema):

   ```bash
   npm run db:restore-check -- /ruta/respaldo.dump
   ```

   El script:
   - Restaura el respaldo en una base temporal.
   - Compara el número de filas de cada tabla con la original.
   - Borra la base temporal.

   Necesita `pg_dump`, `pg_restore` y `psql` en el PATH, o en la carpeta indicada por `PG_BIN`, y un usuario con `CREATEDB`. Un respaldo que nunca se restauró no cuenta como respaldo.

   Verificado en desarrollo el 2026-11-05: 41 tablas, todas las filas coincidieron.

### Restaurar en producción (incidente)
1. Poner la tienda en mantenimiento: detener la API o desactivar el checkout en el storefront.
2. Restaurar a una base **nueva**, con PITR del proveedor o con `pg_restore --no-owner --dbname=<nueva>` del último respaldo.
3. Apuntar `DATABASE_URL` a la base nueva, ejecutar `npm run release` y arrancar.
4. Conciliar los pagos del periodo perdido desde el panel de Wompi. Los eventos que Wompi reintente se aplicarán solos.

## Monitoreo
| Qué | Dónde | Alertar si |
|---|---|---|
| La API responde | `GET /api/health` (sin autenticación), cada minuto | 2 fallos seguidos |
| Estado operativo | `GET /api/v1/admin/system/status` con un token de un usuario con `reports:read` | `healthy` es `false` |
| Errores 5xx | Logs JSON (pino) en el agregador de la plataforma | Más de 5 por minuto |
| Pagos por revisar | Correo a `ADMIN_ALERT_EMAILS`, más `/admin/payments?needsReview=true` | Siempre |

`system/status` reporta:
- El estado de cada proceso programado: última ejecución, último error y fallos seguidos.
- Las notificaciones de Wompi que fallaron al procesarse.
- Las firmas inválidas de las últimas 24 horas.
- Los pagos pendientes estancados.
- Los pedidos vencidos sin cancelar. Si hay alguno, el proceso de vencimiento no está corriendo.

Los logs:
- Son JSON con `x-request-id`, que también viaja en la respuesta y en los errores (`requestId`).
- Ocultan contraseñas, tokens (incluidos los de la URL), cookies, cabeceras de autorización y secretos.

## Procesos programados
| Proceso | Frecuencia | Qué hace |
|---|---|---|
| `ReservationExpiryJob` | cada minuto | Devuelve al stock las reservas de checkout vencidas |
| `OrderExpiryJob` | cada minuto | Cancela los pedidos sin pagar vencidos (espera si hay un pago en curso) |
| `PaymentReconciliationJob` | cada 5 min | Consulta a Wompi los pagos pendientes |
| `GuestCartCleanupJob` | cada hora | Borra carritos de invitado vencidos |

Todos son seguros con varias instancias porque usan actualizaciones condicionales. Si un proceso falla, se envía una alerta en el primer fallo. `JOBS_ENABLED=false` los apaga en una instancia, por ejemplo una réplica solo de lectura.

## Notificaciones
- Los correos salen **después** de confirmar la transacción. Si el SMTP falla, el error se registra en el log y el pedido no se ve afectado.
- El bus de eventos es en memoria: si el proceso se cae justo entre el commit y el envío, ese correo se pierde. Si llega a ser un problema, migrar a una tabla outbox.

## Procedimientos frecuentes
- **Pago aprobado de un pedido vencido** (`reviewReason = ORDER_NOT_PAYABLE`):
  1. Reembolsar desde `POST /admin/payments/:id/refunds`.
  2. O, si el cliente lo prefiere y hay stock, crear un pedido nuevo y reembolsar el viejo.
- **Reembolso que quedó `PENDING`**: verificarlo en el panel de Wompi y confirmar el resultado con `PATCH /admin/refunds/:id`.
- **Factura electrónica**: mientras no haya un proveedor integrado, emitirla en el facturador de la DIAN y registrarla con `PUT /admin/orders/:id/invoice`. Los pedidos pendientes de factura se listan con `GET /admin/orders?invoicePending=true`.
- **Retracto (Ley 1480)**: reembolsar (total o parcial) con `restock: true` cuando la pieza regresa en buen estado.
- **Solicitud de un titular de datos (Ley 1581)**: el titular descarga sus datos en `GET /account/data` y borra su cuenta con `DELETE /account`. Si la solicitud llega por otro canal, verificar la identidad y responder dentro de los plazos de ley, que son de 10 días hábiles para consultas y 15 para reclamos.
