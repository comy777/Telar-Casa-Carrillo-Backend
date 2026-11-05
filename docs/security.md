# Revisión de seguridad y privacidad

Revisión hecha el 2026-11-05 sobre el código de las Fases 1 a 8. Cada control tiene una prueba automática cuando aplica (`test/security.e2e-spec.ts` y pruebas unitarias).

## Controles implementados
| Área | Control |
|---|---|
| Autenticación | Access token JWT de 15 min (HS256, issuer/audience fijos) solo en memoria; refresh token opaco en cookie `HttpOnly`, `SameSite=Strict`, con rotación y revocación de toda la familia si se reutiliza; Argon2id; tiempo constante ante correos inexistentes. |
| Autorización | Guard global: toda ruta exige sesión salvo `@Public()`. Permisos leídos de la base en cada petición. **Prueba**: cada ruta `/admin` (más de 40) responde 401 sin sesión y 403 a un cliente. |
| Datos de otros | Los pedidos se consultan solo con la cuenta dueña o con el token del invitado (hash SHA-256, comparación en tiempo constante); un pedido ajeno o inexistente da el mismo 404. |
| Entrada | `ValidationPipe` con `whitelist` y `forbidNonWhitelisted`; límite de 1 MB en JSON; imágenes validadas por contenido (no por extensión), máx. 5 MB; SQL siempre parametrizado (`Prisma.sql`). |
| Dinero | Precios, IVA, descuentos y envío calculados en el servidor; el pago solo se confirma por evento firmado de Wompi o consulta con la llave privada; montos comparados contra lo cobrado; reembolsos con `Idempotency-Key` y tope en lo pagado. |
| Concurrencia | Stock con `UPDATE` condicional (sin sobreventa, probado con compras simultáneas); cupones bloqueados con `FOR UPDATE`; transiciones de pedido y pago condicionales al estado anterior. |
| HTTP | Helmet (CSP, HSTS, nosniff, sin `x-powered-by`), CORS por lista, `Cache-Control: no-store` por defecto en respuestas privadas, límites de peticiones (global 120/min; login, registro y recuperación 5/min; checkout y pagos 10/min), `TRUST_PROXY` para ver la IP real. |
| Webhooks | Firma verificada en tiempo constante; firmas inválidas se guardan y responden 401; idempotencia por evento. |
| Logs | Ocultan contraseñas, tokens (también `?token=` en la URL), cookies, `Authorization`, `X-Order-Token`, `Idempotency-Key` y secretos. Los errores 500 no exponen detalles. |
| Exportaciones | CSV con celdas que empiezan por `= + - @` neutralizadas (inyección de fórmulas). |
| Secretos | Validados al arrancar (en producción no se aceptan valores de ejemplo ni llaves de sandbox con la URL de producción); soporte de `*_FILE` para gestores de secretos. |

## Privacidad (Ley 1581 de 2012)
- Se guarda cuándo y qué versión de la política aceptó cada persona (al registrarse y en cada pedido).
- **Acceso**: `GET /account/data` descarga todos los datos de la cuenta.
- **Supresión**: `DELETE /account` (con contraseña). Borra direcciones, sesiones y carrito, y anonimiza la cuenta. Los pedidos se conservan desligados de la cuenta porque son soporte contable y tributario: confirmar con el contador el plazo de conservación y documentarlo en la política de datos.
- Minimización: el documento del comprador solo se pide para facturar; los tokens de invitado y de cuenta se guardan como hash.

## Riesgos aceptados o pendientes
| Riesgo | Estado |
|---|---|
| Token del invitado en la URL del correo (`?token=`) | Puede quedar en el historial del navegador. Se oculta en los logs y se acepta también por la cabecera `X-Order-Token`. El storefront debería pasarlo a la cabecera y quitarlo de la URL al cargar la página. |
| Bus de eventos en memoria | Un correo puede perderse si el proceso se cae justo después del commit. Mitigación futura: outbox. |
| Sin antivirus para imágenes | Se aceptan solo JPEG, PNG y WebP validados por contenido y se sirven desde Cloudinary, sin ejecutar en el servidor. |
| Rate limit en memoria por instancia | Con varias instancias el límite efectivo se multiplica. Si se escala, usar un almacén compartido (Redis) para el throttler. |
| Sin 2FA para administradores | Recomendado antes de tener varios administradores. |
| Revisión externa | Antes de producción, una prueba de penetración o revisión por terceros. |
