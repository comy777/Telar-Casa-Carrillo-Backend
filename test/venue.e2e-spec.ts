import request from 'supertest';
import { VENUE_CONFIG, type VenueConfig } from '../src/modules/venue/application/venue.services';
import { bearer, PNG, signIn } from './support/fixtures';
import { createTestApp, type TestApp } from './support/test-app';

const STORE = 'tienda@example.com';

/** Día de Colombia (UTC−5) a `offsetDays` de hoy, "AAAA-MM-DD". */
const colombiaDay = (offsetDays: number) =>
  new Date(Date.now() - 5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe('El lugar: «Visítanos», actividades y cotizaciones (e2e)', () => {
  let t: TestApp;
  let admin: string;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    // Las pruebas no configuran ADMIN_ALERT_EMAILS: se fija aquí el correo de la tienda.
    const config = t.app.get<VenueConfig>(VENUE_CONFIG);
    config.adminAlertEmails.splice(0, config.adminAlertEmails.length, STORE);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await signIn(t, 'admin@example.com', 'admin')).token;
    t.emails.clear();
  });

  const createActivity = async (body: Record<string, unknown>) =>
    (await http().post('/api/v1/admin/venue/activities').set(bearer(admin)).send(body).expect(201))
      .body as { id: string; name: string; isPublished: boolean; imageUrl: string | null };

  const quote = (body: Record<string, unknown>) =>
    http()
      .post('/api/v1/venue/quotes')
      .send({
        name: 'Laura Gómez',
        email: 'laura@example.com',
        phone: '3001234567',
        acceptPrivacy: true,
        ...body,
      });

  it('la página pública muestra los ajustes y solo las actividades publicadas, en orden', async () => {
    const vacia = await http().get('/api/v1/venue').expect(200);
    expect(vacia.headers['cache-control']).toBe('public, max-age=60');
    expect(vacia.body).toEqual({
      settings: {
        title: null,
        intro: null,
        schedule: null,
        address: null,
        mapUrl: null,
        quoteNote: null,
      },
      activities: [],
    });

    await createActivity({ name: 'Voleibol', sortOrder: 3 });
    await createActivity({
      name: 'Banquitas',
      description: 'Fútbol en cancha pequeña',
      sortOrder: 1,
    });
    await createActivity({ name: 'Oculta', isPublished: false, sortOrder: 0 });
    await http()
      .put('/api/v1/admin/venue/settings')
      .set(bearer(admin))
      .send({
        title: '  Visítanos  ',
        schedule: 'Sábados\nDomingos',
        mapUrl: 'https://maps.example.com/lugar',
      })
      .expect(200);

    const res = await http().get('/api/v1/venue').expect(200);
    expect(res.body).toMatchObject({
      settings: {
        title: 'Visítanos',
        schedule: 'Sábados\nDomingos',
        mapUrl: 'https://maps.example.com/lugar',
        address: null,
      },
    });
    const activities = (res.body as { activities: Array<Record<string, unknown>> }).activities;
    expect(activities.map((a) => a.name)).toEqual(['Banquitas', 'Voleibol']);
    expect(activities[0]).toEqual({
      id: expect.any(String) as unknown,
      name: 'Banquitas',
      description: 'Fútbol en cancha pequeña',
      imageUrl: null,
      imageAlt: null,
    });
  });

  it('los ajustes validan el enlace del mapa y las longitudes', async () => {
    await http()
      .put('/api/v1/admin/venue/settings')
      .set(bearer(admin))
      .send({ mapUrl: 'http://inseguro.example.com' })
      .expect(422)
      .expect((r) => expect((r.body as { code: string }).code).toBe('INVALID_LINK'));
    await http()
      .put('/api/v1/admin/venue/settings')
      .set(bearer(admin))
      .send({ quoteNote: 'x'.repeat(301) })
      .expect(400);
  });

  it.each([
    ['EVENT', { eventDate: colombiaDay(10), people: 50, includesFood: true }],
    ['GROUP_VISIT', { people: 25 }],
    ['COURT_RENTAL', { eventDate: colombiaDay(1), startTime: '16:30', durationHours: 2 }],
  ])('guarda una cotización %s y envía dos correos', async (kind, fields) => {
    const banquitas = await createActivity({ name: 'Banquitas' });
    await http()
      .put('/api/v1/admin/venue/settings')
      .set(bearer(admin))
      .send({ quoteNote: 'Respondemos en dos días hábiles.' })
      .expect(200);

    const res = await quote({ kind, ...fields, activityIds: [banquitas.id] }).expect(202);
    expect(res.body).toEqual({ ok: true });

    const saved = await t.prisma.quoteRequest.findFirstOrThrow();
    expect(saved).toMatchObject({
      kind,
      email: 'laura@example.com',
      activityNames: ['Banquitas'],
      status: 'NEW',
      policyVersion: expect.any(String) as unknown,
    });

    expect(t.emails.sent).toHaveLength(2);
    const toStore = t.emails.sent.find((m) => m.to === STORE);
    const toCustomer = t.emails.sent.find((m) => m.to === 'laura@example.com');
    expect(toStore?.subject).toContain('Nueva solicitud de cotización');
    expect(toStore?.text).toContain('Banquitas');
    expect(toCustomer?.subject).toBe('Recibimos tu solicitud de cotización');
    expect(toCustomer?.text).toContain('Respondemos en dos días hábiles.');
  });

  it.each([
    ['EVENT', { eventDate: colombiaDay(3) }, 'PEOPLE_REQUIRED'],
    ['EVENT', { people: 10 }, 'EVENT_DATE_REQUIRED'],
    ['GROUP_VISIT', {}, 'PEOPLE_REQUIRED'],
    ['COURT_RENTAL', { eventDate: colombiaDay(3), durationHours: 1 }, 'START_TIME_REQUIRED'],
    ['COURT_RENTAL', { eventDate: colombiaDay(3), startTime: '10:00' }, 'DURATION_REQUIRED'],
    [
      'COURT_RENTAL',
      { eventDate: colombiaDay(3), startTime: '25:00', durationHours: 1 },
      'INVALID_START_TIME',
    ],
    ['GROUP_VISIT', { people: 10, eventDate: colombiaDay(-1) }, 'EVENT_DATE_IN_PAST'],
    ['GROUP_VISIT', { people: 10, acceptPrivacy: false }, 'CONSENT_REQUIRED'],
  ])('%s con %j responde 422 %s', async (kind, fields, code) => {
    const res = await quote({ kind, ...fields }).expect(422);
    expect((res.body as { code: string }).code).toBe(code);
    expect(await t.prisma.quoteRequest.count()).toBe(0);
    expect(t.emails.sent).toHaveLength(0);
  });

  it('rechaza con 400 datos mal formados', async () => {
    await quote({ kind: 'PICNIC', people: 3 }).expect(400);
    await quote({
      kind: 'COURT_RENTAL',
      eventDate: colombiaDay(2),
      startTime: '10:00',
      durationHours: 13,
    }).expect(400);
    await quote({ kind: 'GROUP_VISIT', people: 3, phone: undefined }).expect(400);
  });

  it('no acepta actividades sin publicar', async () => {
    const oculta = await createActivity({ name: 'Oculta', isPublished: false });
    const res = await quote({ kind: 'GROUP_VISIT', people: 8, activityIds: [oculta.id] }).expect(
      422,
    );
    expect((res.body as { code: string }).code).toBe('ACTIVITY_NOT_AVAILABLE');
    expect(await t.prisma.quoteRequest.count()).toBe(0);
  });

  it('administra una actividad con su imagen y borra los archivos', async () => {
    const created = await createActivity({ name: 'Ping pong', description: 'Dos mesas' });
    expect(created).toMatchObject({ name: 'Ping pong', isPublished: true, imageUrl: null });

    const first = await http()
      .put(`/api/v1/admin/venue/activities/${created.id}/image`)
      .set(bearer(admin))
      .attach('file', PNG, 'mesa.png')
      .expect(200);
    const firstUrl = (first.body as { imageUrl: string }).imageUrl;
    expect(firstUrl).toMatch(/^https:\/\/cdn\.test\/venue\//);
    expect(t.images.files.size).toBe(1);

    const second = await http()
      .put(`/api/v1/admin/venue/activities/${created.id}/image`)
      .set(bearer(admin))
      .attach('file', PNG, 'mesa2.png')
      .expect(200);
    expect((second.body as { imageUrl: string }).imageUrl).not.toBe(firstUrl);
    expect(t.images.files.size).toBe(1);

    const patched = await http()
      .patch(`/api/v1/admin/venue/activities/${created.id}`)
      .set(bearer(admin))
      .send({ imageAlt: 'Mesa de ping pong', isPublished: false, sortOrder: 4 })
      .expect(200);
    expect(patched.body).toMatchObject({
      name: 'Ping pong',
      description: 'Dos mesas',
      imageAlt: 'Mesa de ping pong',
      isPublished: false,
      sortOrder: 4,
      updatedAt: expect.any(String) as unknown,
    });

    const sinImagen = await http()
      .delete(`/api/v1/admin/venue/activities/${created.id}/image`)
      .set(bearer(admin))
      .expect(200);
    expect(sinImagen.body).toMatchObject({ imageUrl: null });
    expect(t.images.files.size).toBe(0);

    await http()
      .put(`/api/v1/admin/venue/activities/${created.id}/image`)
      .set(bearer(admin))
      .attach('file', PNG, 'mesa3.png')
      .expect(200);
    expect(t.images.files.size).toBe(1);

    await http()
      .delete(`/api/v1/admin/venue/activities/${created.id}`)
      .set(bearer(admin))
      .expect(204);
    expect(t.images.files.size).toBe(0);
    const list = await http().get('/api/v1/admin/venue/activities').set(bearer(admin)).expect(200);
    expect(list.body).toEqual([]);

    const audit = await t.prisma.auditLog.findMany({ where: { resource: 'VenueActivity' } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['venue_activity.created', 'venue_activity.deleted']),
    );
  });

  it('lista, filtra y actualiza las cotizaciones desde el panel', async () => {
    await quote({ kind: 'GROUP_VISIT', people: 12 }).expect(202);
    // La primera queda una hora antes para que el orden no dependa del milisegundo.
    await t.prisma.quoteRequest.updateMany({
      data: { createdAt: new Date(Date.now() - 3_600_000) },
    });
    await quote({
      kind: 'COURT_RENTAL',
      eventDate: colombiaDay(2),
      startTime: '08:00',
      durationHours: 1,
    }).expect(202);

    const all = await http().get('/api/v1/admin/quotes').set(bearer(admin)).expect(200);
    expect(all.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    const items = (all.body as { items: Array<{ id: string; kind: string }> }).items;
    expect(items.map((i) => i.kind)).toEqual(['COURT_RENTAL', 'GROUP_VISIT']);

    const courts = await http()
      .get('/api/v1/admin/quotes?kind=COURT_RENTAL')
      .set(bearer(admin))
      .expect(200);
    expect(courts.body).toMatchObject({ total: 1 });
    const court = (courts.body as { items: Array<Record<string, unknown>> }).items[0]!;
    expect(court).toMatchObject({
      eventDate: colombiaDay(2),
      startTime: '08:00',
      durationHours: 1,
      people: null,
      activityNames: [],
      includesFood: false,
      status: 'NEW',
      adminNotes: null,
    });
    expect(court).not.toHaveProperty('consentAt');

    const updated = await http()
      .patch(`/api/v1/admin/quotes/${court.id as string}`)
      .set(bearer(admin))
      .send({ status: 'QUOTED', adminNotes: 'Enviamos precio por WhatsApp' })
      .expect(200);
    expect(updated.body).toMatchObject({
      status: 'QUOTED',
      adminNotes: 'Enviamos precio por WhatsApp',
    });

    const one = await http()
      .get(`/api/v1/admin/quotes/${court.id as string}`)
      .set(bearer(admin))
      .expect(200);
    expect(one.body).toMatchObject({ status: 'QUOTED' });

    const fresh = await http()
      .get('/api/v1/admin/quotes?status=NEW')
      .set(bearer(admin))
      .expect(200);
    expect(fresh.body).toMatchObject({ total: 1 });

    const metrics = await http().get('/api/v1/admin/metrics').set(bearer(admin)).expect(200);
    expect(metrics.body).toMatchObject({ operations: { newQuoteRequests: 1 } });

    expect(await t.prisma.auditLog.count({ where: { action: 'quote_request.updated' } })).toBe(1);
  });

  it('un cliente no entra al panel del lugar ni a las cotizaciones', async () => {
    const customer = (await signIn(t, 'cliente@example.com')).token;
    await http().get('/api/v1/admin/quotes').set(bearer(customer)).expect(403);
    await http()
      .patch(`/api/v1/admin/quotes/${crypto.randomUUID()}`)
      .set(bearer(customer))
      .send({ status: 'CLOSED' })
      .expect(403);
    await http().get('/api/v1/admin/venue/activities').set(bearer(customer)).expect(403);
    await http()
      .post('/api/v1/admin/venue/activities')
      .set(bearer(customer))
      .send({ name: 'Intruso' })
      .expect(403);
    await http().put('/api/v1/admin/venue/settings').set(bearer(customer)).send({}).expect(403);
    await http().get('/api/v1/admin/quotes').expect(401);
  });
});
