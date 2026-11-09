import request from 'supertest';
import { bearer, signIn } from './support/fixtures';
import { createTestApp, type TestApp } from './support/test-app';

describe('Contenido público editable desde el panel (e2e)', () => {
  let t: TestApp;
  let admin: string;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await signIn(t, 'admin@example.com', 'admin')).token;
  });

  it('lista solo las páginas publicadas, ordenadas por título', async () => {
    const crear = (slug: string, title: string, isPublished: boolean) =>
      http()
        .post('/api/v1/admin/content/pages')
        .set(bearer(admin))
        .send({ slug, title, body: 'Texto de la página.', isPublished })
        .expect(201);
    await crear('terminos-y-condiciones', 'Términos y condiciones', true);
    await crear('envios', 'Envíos', true);
    await crear('borrador', 'Borrador interno', false);

    const res = await http().get('/api/v1/content/pages').expect(200);

    expect(res.body).toEqual([
      expect.objectContaining({ slug: 'envios', title: 'Envíos' }),
      expect.objectContaining({ slug: 'terminos-y-condiciones', title: 'Términos y condiciones' }),
    ]);
    expect(res.body[0]).not.toHaveProperty('body');
  });

  it('guarda el nombre de la tienda y lo expone en los ajustes públicos', async () => {
    const vacio = await http().get('/api/v1/content/settings').expect(200);
    expect(vacio.body).toMatchObject({ storeName: null });

    await http()
      .put('/api/v1/admin/content/settings')
      .set(bearer(admin))
      .send({ storeName: '  Telar Casa Carrillo  ', tagline: 'Ruanas tejidas en telar' })
      .expect(200);

    const res = await http().get('/api/v1/content/settings').expect(200);
    expect(res.body).toMatchObject({
      storeName: 'Telar Casa Carrillo',
      tagline: 'Ruanas tejidas en telar',
    });
  });
});
