import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app';

const PASSWORD = 'telar de la abuela 2026';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

interface ProductBody {
  id: string;
  slug: string;
  status: string;
  variants: { id: string; sku: string; price: number; isActive: boolean }[];
  images: { id: string; url: string; isPrimary: boolean }[];
}

describe('Catálogo (e2e, base de datos real)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  /** Usuario verificado con sesión; con `admin` recibe el rol de administrador. */
  const signIn = async (email: string, admin = false): Promise<string> => {
    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Ana', lastName: 'Pérez', acceptTerms: true })
      .expect(201);
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: t.emails.lastToken(email, /Confirma/) })
      .expect(204);
    if (admin) {
      const user = await t.prisma.user.findUniqueOrThrow({ where: { email } });
      const role = await t.prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
      await t.prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }
    const response = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  };

  let token: string;
  const admin = () => ({
    get: (url: string) => http().get(`/api/v1/admin${url}`).set(bearer(token)),
    post: (url: string) => http().post(`/api/v1/admin${url}`).set(bearer(token)),
    patch: (url: string) => http().patch(`/api/v1/admin${url}`).set(bearer(token)),
    put: (url: string) => http().put(`/api/v1/admin${url}`).set(bearer(token)),
    delete: (url: string) => http().delete(`/api/v1/admin${url}`).set(bearer(token)),
  });
  const store = (url: string) => http().get(`/api/v1/catalog${url}`);

  const createProduct = async (overrides: Record<string, unknown> = {}): Promise<ProductBody> => {
    const response = await admin()
      .post('/products')
      .send({
        name: 'Mochila wayuu tradicional',
        sku: 'MOCH-WAY',
        description: 'Mochila tejida a mano en La Guajira con hilo de algodón.',
        variants: [
          { name: 'Grande', sku: 'MOCH-WAY-G', price: 220000, attributes: { tamaño: 'Grande' } },
          { name: 'Mediana', sku: 'MOCH-WAY-M', price: 185000, attributes: { tamaño: 'Mediana' } },
        ],
        ...overrides,
      })
      .expect(201);
    return response.body as ProductBody;
  };

  const uploadImage = (productId: string, data: Buffer = PNG, filename = 'foto.png') =>
    admin().post(`/products/${productId}/images`).attach('file', data, filename);

  /** Producto con imagen y publicado. */
  const publishedProduct = async (overrides: Record<string, unknown> = {}) => {
    const product = await createProduct(overrides);
    await uploadImage(product.id).expect(201);
    await admin().patch(`/products/${product.id}/status`).send({ status: 'ACTIVE' }).expect(200);
    return product;
  };

  beforeEach(async () => {
    await t.reset();
    token = await signIn('admin@example.com', true);
  });

  describe('autorización', () => {
    it('la tienda es pública y la administración exige permisos', async () => {
      await store('/products').expect(200);
      await http().get('/api/v1/admin/products').expect(401);

      const customer = await signIn('cliente@example.com');
      const response = await http()
        .post('/api/v1/admin/products')
        .set(bearer(customer))
        .send({})
        .expect(403);
      expect(response.body).toMatchObject({
        code: 'MISSING_PERMISSION',
        details: { missing: ['catalog:manage'] },
      });
    });
  });

  describe('productos', () => {
    it('un borrador no aparece en la tienda', async () => {
      const product = await createProduct();
      expect(product).toMatchObject({ status: 'DRAFT', slug: 'mochila-wayuu-tradicional' });

      await store(`/products/${product.slug}`).expect(404);
      const list = await store('/products').expect(200);
      expect(list.body).toMatchObject({ items: [], total: 0 });
    });

    it('no se publica sin imagen', async () => {
      const product = await createProduct();
      const response = await admin()
        .patch(`/products/${product.id}/status`)
        .send({ status: 'ACTIVE' })
        .expect(422);
      expect(response.body).toMatchObject({
        code: 'PRODUCT_NOT_PUBLISHABLE',
        details: { missing: ['imagen'] },
      });
    });

    it('publicado aparece en la tienda con precio "desde", galería y SEO', async () => {
      const product = await publishedProduct({ shortDescription: 'Hecha a mano' });

      const list = await store('/products').expect(200);
      expect(list.headers['cache-control']).toContain('max-age=60');
      expect(list.body).toMatchObject({
        total: 1,
        items: [
          {
            slug: 'mochila-wayuu-tradicional',
            price: 185000,
            currency: 'COP',
            hasMultipleVariants: true,
            image: { url: expect.stringContaining('https://cdn.test/products/') as unknown },
          },
        ],
      });

      const detail = await store(`/products/${product.slug}`).expect(200);
      expect(detail.body).toMatchObject({
        taxRate: 0.19,
        variants: [
          { sku: 'MOCH-WAY-M', price: 185000, attributes: { tamaño: 'Mediana' } },
          { sku: 'MOCH-WAY-G', price: 220000 },
        ],
        seo: {
          title: 'Mochila wayuu tradicional',
          description: 'Hecha a mano',
          image: expect.stringContaining('https://cdn.test/') as unknown,
        },
      });
      expect(detail.body).not.toHaveProperty('variants.0.isActive');
    });

    it('oculta las variantes inactivas y no deja desactivar la última', async () => {
      const product = await publishedProduct();
      const [grande, mediana] = product.variants.slice().sort((a, b) => b.price - a.price) as [
        ProductBody['variants'][0],
        ProductBody['variants'][0],
      ];

      await admin()
        .patch(`/products/${product.id}/variants/${mediana.id}`)
        .send({ isActive: false })
        .expect(200);
      const detail = await store(`/products/${product.slug}`).expect(200);
      expect((detail.body as ProductBody).variants.map((v) => v.sku)).toEqual(['MOCH-WAY-G']);

      const response = await admin()
        .patch(`/products/${product.id}/variants/${grande.id}`)
        .send({ isActive: false })
        .expect(422);
      expect(response.body).toMatchObject({ code: 'LAST_ACTIVE_VARIANT' });
    });

    it('rechaza slugs y SKU repetidos', async () => {
      await createProduct();
      const slug = await admin()
        .post('/products')
        .send({
          name: 'Mochila wayuu tradicional',
          sku: 'OTRA',
          description: 'x',
          variants: [{ name: 'Única', sku: 'OTRA-U', price: 1000 }],
        })
        .expect(409);
      expect(slug.body).toMatchObject({ code: 'SLUG_TAKEN' });

      const sku = await admin()
        .post('/products')
        .send({
          name: 'Otra mochila',
          sku: 'OTRA',
          description: 'x',
          variants: [{ name: 'Única', sku: 'moch-way-g', price: 1000 }],
        })
        .expect(409);
      expect(sku.body).toMatchObject({ code: 'SKU_TAKEN' });
    });

    it('valida la entrada', async () => {
      const response = await admin()
        .post('/products')
        .send({
          name: 'Hamaca',
          sku: 'HAM',
          description: 'x',
          variants: [{ name: 'Única', sku: 'HAM-U', price: 1000, compareAtPrice: 900 }],
        })
        .expect(422);
      expect(response.body).toMatchObject({ code: 'COMPARE_AT_PRICE_NOT_HIGHER' });

      await admin()
        .post('/products')
        .send({ name: 'Hamaca', sku: 'HAM', description: 'x', variants: [] })
        .expect(400);
      await admin()
        .post('/products')
        .send({
          name: 'Hamaca',
          sku: 'HAM',
          description: 'x',
          variants: [{ name: 'Única', sku: 'HAM-U', price: 1000, attributes: { color: 3 } }],
        })
        .expect(400);
    });

    it('archivar lo saca de la tienda y del sitemap', async () => {
      const product = await publishedProduct();
      let sitemap = await store('/sitemap').expect(200);
      expect(sitemap.body).toMatchObject({ products: [{ slug: product.slug }] });

      await admin()
        .patch(`/products/${product.id}/status`)
        .send({ status: 'ARCHIVED' })
        .expect(200);
      await store(`/products/${product.slug}`).expect(404);
      sitemap = await store('/sitemap').expect(200);
      expect(sitemap.body).toMatchObject({ products: [] });
    });

    it('deja auditoría de los cambios', async () => {
      const product = await publishedProduct();
      const logs = await t.prisma.auditLog.findMany({
        where: { resourceId: product.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((log) => log.action)).toEqual([
        'product.created',
        'product.image_added',
        'product.status_changed',
      ]);
      expect(logs[2]?.metadata).toEqual({ from: 'DRAFT', to: 'ACTIVE' });
    });
  });

  describe('imágenes', () => {
    it('valida el archivo por su contenido', async () => {
      const product = await createProduct();
      const fake = await uploadImage(product.id, Buffer.from('<svg></svg>'), 'foto.png').expect(
        422,
      );
      expect(fake.body).toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' });
      expect(t.images.files.size).toBe(0);

      const missing = await admin().post(`/products/${product.id}/images`).expect(400);
      expect(missing.body).toMatchObject({ detail: 'Falta el archivo en el campo "file"' });

      await uploadImage(product.id, Buffer.alloc(5 * 1024 * 1024 + 1, 0xff)).expect(413);
    });

    it('borra el archivo subido si no se puede guardar', async () => {
      const product = await createProduct();
      await admin()
        .post(`/products/${product.id}/images`)
        .field('variantId', crypto.randomUUID())
        .attach('file', PNG, 'foto.png')
        .expect(404);
      expect(t.images.files.size).toBe(0);
    });

    it('cambia la imagen principal y borra el archivo al quitarla', async () => {
      const product = await createProduct();
      await uploadImage(product.id).expect(201);
      const second = await uploadImage(product.id).expect(201);
      const [first, other] = (second.body as ProductBody).images as [
        ProductBody['images'][0],
        ProductBody['images'][0],
      ];
      expect([first.isPrimary, other.isPrimary]).toEqual([true, false]);

      const updated = await admin()
        .patch(`/products/${product.id}/images/${other.id}`)
        .send({ isPrimary: true, altText: 'Mochila vista de frente' })
        .expect(200);
      expect((updated.body as ProductBody).images.find((i) => i.isPrimary)?.id).toBe(other.id);

      expect(t.images.files.size).toBe(2);
      const removed = await admin()
        .delete(`/products/${product.id}/images/${other.id}`)
        .expect(200);
      expect((removed.body as ProductBody).images).toEqual([
        expect.objectContaining({ id: first.id, isPrimary: true }),
      ]);
      expect(t.images.files.size).toBe(1);
    });
  });

  describe('categorías, artesanos y filtros', () => {
    const createCategory = async (name: string, parentId?: string) =>
      (
        await admin()
          .post('/categories')
          .send({ name, ...(parentId ? { parentId } : {}) })
          .expect(201)
      ).body as { id: string; slug: string };

    it('filtra por categoría (con subcategorías), artesano, material, precio y texto', async () => {
      const moda = await createCategory('Moda');
      const bolsos = await createCategory('Bolsos', moda.id);
      const hogar = await createCategory('Hogar');
      const artisan = (
        await admin()
          .post('/artisans')
          .send({ name: 'Familia Epieyú', biography: 'Tejedoras wayuu' })
          .expect(201)
      ).body as { id: string; slug: string };
      expect(artisan.slug).toBe('familia-epieyu');

      await publishedProduct({
        categoryIds: [bolsos.id],
        artisanId: artisan.id,
        materials: ['algodón'],
      });
      await publishedProduct({
        name: 'Hamaca sanjacintera',
        sku: 'HAM-SJ',
        description: 'Hamaca de telar vertical.',
        categoryIds: [hogar.id],
        materials: ['Hilo de fique'],
        variants: [{ name: 'Doble', sku: 'HAM-SJ-D', price: 450000 }],
      });

      const slugs = async (query: string) =>
        (
          (await store(`/products${query}`).expect(200)).body as { items: { slug: string }[] }
        ).items.map((item) => item.slug);

      expect(await slugs('?category=moda')).toEqual(['mochila-wayuu-tradicional']);
      expect(await slugs('?artisan=familia-epieyu')).toEqual(['mochila-wayuu-tradicional']);
      expect(await slugs('?material=hilo%20de%20fique')).toEqual(['hamaca-sanjacintera']);
      expect(await slugs('?minPrice=300000')).toEqual(['hamaca-sanjacintera']);
      expect(await slugs('?maxPrice=200000')).toEqual(['mochila-wayuu-tradicional']);
      expect(await slugs('?sort=price_desc')).toEqual([
        'hamaca-sanjacintera',
        'mochila-wayuu-tradicional',
      ]);
      // "mochilas" encuentra "mochila" (búsqueda en español) y "tela" encuentra "telar" (parcial).
      expect(await slugs('?q=mochilas')).toEqual(['mochila-wayuu-tradicional']);
      expect(await slugs('?q=hamac')).toEqual(['hamaca-sanjacintera']);
      expect(await slugs('?q=telar')).toEqual(['hamaca-sanjacintera']);
      await store('/products?category=no-existe').expect(404);

      const materials = await store('/materials').expect(200);
      expect(materials.body).toEqual(['Algodón', 'Hilo de fique']);

      const profile = await store('/artisans/familia-epieyu').expect(200);
      expect(profile.body).toMatchObject({ name: 'Familia Epieyú', publishedProducts: 1 });

      const detail = await store('/products/mochila-wayuu-tradicional').expect(200);
      expect(detail.body).toMatchObject({
        artisan: { slug: 'familia-epieyu', biography: 'Tejedoras wayuu' },
        categories: [{ slug: 'bolsos' }],
        materials: ['Algodón'],
      });
    });

    it('una categoría inactiva oculta su rama', async () => {
      const moda = await createCategory('Moda');
      await createCategory('Bolsos', moda.id);
      await createCategory('Hogar');

      let tree = await store('/categories').expect(200);
      expect(tree.body).toMatchObject([
        { slug: 'hogar', children: [] },
        { slug: 'moda', children: [{ slug: 'bolsos' }] },
      ]);
      const page = await store('/categories/bolsos').expect(200);
      expect(page.body).toMatchObject({ breadcrumbs: [{ slug: 'moda' }], children: [] });

      await admin().patch(`/categories/${moda.id}`).send({ isActive: false }).expect(200);
      tree = await store('/categories').expect(200);
      expect(tree.body).toMatchObject([{ slug: 'hogar' }]);
      await store('/categories/bolsos').expect(404);
    });

    it('impide ciclos y borrar categorías en uso', async () => {
      const moda = await createCategory('Moda');
      const bolsos = await createCategory('Bolsos', moda.id);

      const cycle = await admin()
        .patch(`/categories/${moda.id}`)
        .send({ parentId: bolsos.id })
        .expect(422);
      expect(cycle.body).toMatchObject({ code: 'CATEGORY_CYCLE' });

      const withChildren = await admin().delete(`/categories/${moda.id}`).expect(422);
      expect(withChildren.body).toMatchObject({ code: 'CATEGORY_HAS_CHILDREN' });

      await createProduct({ categoryIds: [bolsos.id] });
      const inUse = await admin().delete(`/categories/${bolsos.id}`).expect(422);
      expect(inUse.body).toMatchObject({ code: 'CATEGORY_IN_USE' });

      const unknown = await createCategory('Hogar');
      await admin().delete(`/categories/${unknown.id}`).expect(204);
    });

    it('sube y reemplaza la foto del artesano borrando la anterior', async () => {
      const artisan = (await admin().post('/artisans').send({ name: 'Taller Sol' }).expect(201))
        .body as { id: string };
      await admin().put(`/artisans/${artisan.id}/photo`).attach('file', PNG, 'a.png').expect(200);
      const second = await admin()
        .put(`/artisans/${artisan.id}/photo`)
        .attach('file', PNG, 'b.png')
        .expect(200);
      expect(second.body).toMatchObject({
        photoUrl: expect.stringContaining('/artisans/') as unknown,
      });
      expect(second.body).not.toHaveProperty('photoKey');
      expect([...t.images.files.keys()]).toEqual([expect.stringMatching(/^artisans\//) as unknown]);

      // Un artesano inactivo no aparece en la tienda.
      await admin().patch(`/artisans/${artisan.id}`).send({ isActive: false }).expect(200);
      await store('/artisans/taller-sol').expect(404);
    });

    it('rechaza referencias inexistentes', async () => {
      const response = await admin()
        .post('/products')
        .send({
          name: 'Hamaca',
          sku: 'HAM',
          description: 'x',
          artisanId: crypto.randomUUID(),
          variants: [{ name: 'Única', sku: 'HAM-U', price: 1000 }],
        })
        .expect(422);
      expect(response.body).toMatchObject({ code: 'UNKNOWN_ARTISAN' });
    });
  });
});
