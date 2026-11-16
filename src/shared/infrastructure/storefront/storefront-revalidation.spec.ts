import { StorefrontRevalidator, storefrontTagsFor } from './storefront-revalidation';

describe('storefrontTagsFor', () => {
  it.each([
    ['POST', '/api/v1/admin/products', ['catalog']],
    ['PATCH', '/api/v1/admin/products/p1/variants/v1', ['catalog']],
    ['PUT', '/api/v1/admin/categories/c1/image', ['catalog']],
    ['DELETE', '/api/v1/admin/artisans/a1/photo', ['catalog']],
    ['PUT', '/api/v1/admin/inventory/v1/count', ['catalog']],
    ['PATCH', '/api/v1/admin/content/navigation/contacto', ['navigation', 'content']],
    ['PUT', '/api/v1/admin/content/settings', ['content']],
    ['DELETE', '/api/v1/admin/content/banners/b1', ['content']],
    ['POST', '/api/v1/admin/content/pages', ['content']],
  ])('%s %s → %j', (method, path, tags) => {
    expect(storefrontTagsFor(method, path)).toEqual(tags);
  });

  it.each([
    ['GET', '/api/v1/admin/products'],
    ['POST', '/api/v1/cart/items'],
    ['PATCH', '/api/v1/admin/orders/o1/status'],
    ['PATCH', '/api/v1/admin/contact-messages/m1'],
    ['POST', '/api/v1/admin/productsx'],
  ])('%s %s no afecta a la tienda', (method, path) => {
    expect(storefrontTagsFor(method, path)).toEqual([]);
  });
});

describe('StorefrontRevalidator', () => {
  const settings = { url: 'http://tienda/api/revalidate', secret: 'secreto-de-pruebas-123' };

  it('agrupa las etiquetas y envía un solo aviso autenticado', async () => {
    const http = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const revalidator = new StorefrontRevalidator(settings, http);
    revalidator.schedule(['catalog']);
    revalidator.schedule(['content', 'catalog']);
    await revalidator.flush();
    revalidator.onModuleDestroy();

    expect(http).toHaveBeenCalledTimes(1);
    const [url, init] = http.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(settings.url);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${settings.secret}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['catalog', 'content'] });
  });

  it('sin secreto no hace nada', async () => {
    const http = jest.fn();
    const revalidator = new StorefrontRevalidator({ url: settings.url, secret: undefined }, http);
    revalidator.schedule(['catalog']);
    await revalidator.flush();
    expect(revalidator.enabled).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });

  it('un fallo de la tienda no lanza error', async () => {
    const http = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const revalidator = new StorefrontRevalidator(settings, http);
    revalidator.schedule(['content']);
    await expect(revalidator.flush()).resolves.toBeUndefined();
  });
});
