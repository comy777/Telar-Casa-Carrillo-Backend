import request from 'supertest';
import { bearer, cookieFrom } from './fixtures';
import type { TestApp } from './test-app';

type Pending = Promise<request.Response> & {
  /** Como supertest, pero muestra el cuerpo si el estado no coincide. */
  expect(status: number): Promise<request.Response>;
};

/**
 * Cliente de la tienda (invitado, o con sesión si se pasa `token`) que conserva
 * la cookie del carrito entre peticiones.
 */
export function shopper(t: TestApp, token?: string) {
  let cookie: string | null = null;
  const http = () => request(t.app.getHttpServer());

  const send = (req: request.Test): Pending => {
    let prepared = cookie ? req.set('Cookie', cookie) : req;
    if (token) prepared = prepared.set(bearer(token));
    const promise = prepared.then((response) => {
      cookie = cookieFrom(response, 'tcc_cart') ?? cookie;
      return response;
    });
    return Object.assign(promise, {
      expect: async (status: number) => {
        const response = await promise;
        if (response.status !== status) {
          throw new Error(
            `Se esperaba ${status} y llegó ${response.status}: ${JSON.stringify(response.body)}`,
          );
        }
        return response;
      },
    });
  };

  return {
    get cookie() {
      return cookie;
    },
    send,
    cart: () => send(http().get('/api/v1/cart')),
    add: (variantId: string, quantity = 1) =>
      send(http().post('/api/v1/cart/items').send({ variantId, quantity })),
    set: (variantId: string, quantity: number) =>
      send(http().patch(`/api/v1/cart/items/${variantId}`).send({ quantity })),
    reserve: () => send(http().post('/api/v1/cart/reservation')),
    release: () => send(http().delete('/api/v1/cart/reservation')),
    quote: (body: Record<string, unknown>) =>
      send(http().post('/api/v1/checkout/quote').send(body)),
    order: (body: Record<string, unknown>) =>
      send(http().post('/api/v1/checkout/orders').send(body)),
  };
}

export const ADDRESS = {
  recipient: 'Ana Pérez',
  phone: '+57 300 123 4567',
  line1: 'Calle 10 # 5-23',
  city: 'Riohacha',
  cityDaneCode: '44001',
};

/** Datos de un pedido de invitado válidos; se sobrescriben por prueba. */
export const guestOrder = (shippingMethodId: string, overrides: Record<string, unknown> = {}) => ({
  email: 'ana@example.com',
  customerName: 'Ana Pérez',
  phone: '3001234567',
  document: { type: 'CC', number: '1020304050' },
  shippingAddress: ADDRESS,
  shippingMethodId,
  acceptTerms: true,
  ...overrides,
});

export async function createShippingMethod(
  t: TestApp,
  adminToken: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(t.app.getHttpServer())
    .post('/api/v1/admin/shipping-methods')
    .set(bearer(adminToken))
    .send({ name: 'Envío nacional', basePrice: 15000, ...body })
    .expect(201);
  return (response.body as { id: string }).id;
}
