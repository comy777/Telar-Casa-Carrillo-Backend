import {
  type BannerProps,
  isBannerLive,
  newContactMessage,
  safeLink,
  validateBanner,
  validatePage,
  validateSettings,
  validateTestimonial,
  EMPTY_SETTINGS,
} from './content';

const banner = (over: Partial<BannerProps> = {}): BannerProps => ({
  id: 'b1',
  title: 'Ruanas nuevas',
  subtitle: null,
  imageUrl: 'https://res.cloudinary.com/x.jpg',
  imageKey: 'x',
  imageAlt: null,
  targetUrl: null,
  ctaLabel: null,
  isActive: true,
  startsAt: null,
  endsAt: null,
  sortOrder: 0,
  ...over,
});

describe('contenido', () => {
  it('acepta rutas internas y https, rechaza javascript: y rutas protocol-relative', () => {
    expect(safeLink('/categorias/ruanas', 'enlace')).toBe('/categorias/ruanas');
    expect(safeLink('https://instagram.com/x', 'enlace')).toBe('https://instagram.com/x');
    expect(safeLink('', 'enlace')).toBeNull();
    expect(() => safeLink('javascript:alert(1)', 'enlace')).toThrow();
    expect(() => safeLink('//evil.com', 'enlace')).toThrow();
    expect(() => safeLink('http://inseguro.com', 'enlace')).toThrow();
  });

  it('un banner con botón necesita enlace y fechas en orden', () => {
    const { id: _i, imageUrl: _u, imageKey: _k, ...input } = banner();
    expect(() => validateBanner({ ...input, ctaLabel: 'Ver' })).toThrow('enlace');
    expect(() =>
      validateBanner({
        ...input,
        startsAt: new Date('2026-12-02'),
        endsAt: new Date('2026-12-01'),
      }),
    ).toThrow('posterior');
  });

  it('un banner está vigente solo activo y dentro de sus fechas', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    expect(isBannerLive(banner(), now)).toBe(true);
    expect(isBannerLive(banner({ isActive: false }), now)).toBe(false);
    expect(isBannerLive(banner({ startsAt: new Date('2026-11-07') }), now)).toBe(false);
    expect(isBannerLive(banner({ endsAt: new Date('2026-11-06T11:00:00Z') }), now)).toBe(false);
  });

  it('la calificación de un testimonio va de 1 a 5', () => {
    const base = {
      customerName: 'Marta',
      location: null,
      content: 'Muy linda',
      isPublished: true,
      sortOrder: 0,
    };
    expect(validateTestimonial({ ...base, rating: 5 }).rating).toBe(5);
    expect(() => validateTestimonial({ ...base, rating: 6 })).toThrow();
  });

  it('el slug de una página es kebab-case', () => {
    expect(
      validatePage({ slug: 'Tratamiento-De-Datos', title: 'T', body: 'x', isPublished: true }).slug,
    ).toBe('tratamiento-de-datos');
    expect(() =>
      validatePage({ slug: 'con espacios', title: 'T', body: 'x', isPublished: true }),
    ).toThrow();
  });

  it('los ajustes validan el correo y limpian el WhatsApp', () => {
    const s = validateSettings({ ...EMPTY_SETTINGS, whatsapp: '+57 300 123-4567' });
    expect(s.whatsapp).toBe('+573001234567');
    expect(() => validateSettings({ ...EMPTY_SETTINGS, contactEmail: 'no-es-correo' })).toThrow();
  });

  it('un mensaje de contacto normaliza el correo', () => {
    const m = newContactMessage(
      { name: ' Ana ', email: 'ANA@Correo.com', message: 'Hola' },
      new Date(),
    );
    expect(m.email).toBe('ana@correo.com');
    expect(m.name).toBe('Ana');
    expect(m.status).toBe('NEW');
  });
});
