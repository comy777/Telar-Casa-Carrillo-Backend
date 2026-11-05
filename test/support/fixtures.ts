import request from 'supertest';
import type { TestApp } from './test-app';

export const PASSWORD = 'telar de la abuela 2026';
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Primera cookie `nombre=valor` de la respuesta (o null). */
export function cookieFrom(response: request.Response, name: string): string | null {
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`));
  return cookie ? cookie.split(';')[0]! : null;
}

/** Usuario verificado con sesión; con `role` recibe además ese rol. */
export async function signIn(
  t: TestApp,
  email: string,
  role?: string,
): Promise<{ id: string; token: string }> {
  const http = () => request(t.app.getHttpServer());
  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, firstName: 'Ana', lastName: 'Pérez', acceptTerms: true })
    .expect(201);
  await http()
    .post('/api/v1/auth/verify-email')
    .send({ token: t.emails.lastToken(email, /Confirma/) })
    .expect(204);
  const user = await t.prisma.user.findUniqueOrThrow({ where: { email } });
  if (role) {
    const saved = await t.prisma.role.findUniqueOrThrow({ where: { name: role } });
    await t.prisma.userRole.create({ data: { userId: user.id, roleId: saved.id } });
  }
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return { id: user.id, token: (response.body as { accessToken: string }).accessToken };
}

export interface PublishedVariant {
  productId: string;
  slug: string;
  variantId: string;
  sku: string;
}

let sequence = 0;

/**
 * Producto publicado con una variante y `stock` unidades, creado por la API de
 * administración (el token debe tener permisos de catálogo e inventario).
 */
export async function publishedVariant(
  t: TestApp,
  adminToken: string,
  options: { price?: number; stock?: number; name?: string; taxRate?: number } = {},
): Promise<PublishedVariant> {
  const http = () => request(t.app.getHttpServer());
  sequence += 1;
  const sku = `TEST-${sequence}`;
  const created = await http()
    .post('/api/v1/admin/products')
    .set(bearer(adminToken))
    .send({
      name: options.name ?? `Producto de prueba ${sequence}`,
      sku,
      description: 'Pieza tejida a mano.',
      ...(options.taxRate !== undefined ? { taxRate: options.taxRate } : {}),
      variants: [{ name: 'Única', sku: `${sku}-U`, price: options.price ?? 100000 }],
    })
    .expect(201);
  const product = created.body as { id: string; slug: string; variants: { id: string }[] };
  await http()
    .post(`/api/v1/admin/products/${product.id}/images`)
    .set(bearer(adminToken))
    .attach('file', PNG, 'foto.png')
    .expect(201);
  await http()
    .patch(`/api/v1/admin/products/${product.id}/status`)
    .set(bearer(adminToken))
    .send({ status: 'ACTIVE' })
    .expect(200);
  const variantId = product.variants[0]!.id;
  if (options.stock) {
    await http()
      .post(`/api/v1/admin/inventory/${variantId}/receipts`)
      .set(bearer(adminToken))
      .send({ quantity: options.stock })
      .expect(201);
  }
  return { productId: product.id, slug: product.slug, variantId, sku: `${sku}-U` };
}
