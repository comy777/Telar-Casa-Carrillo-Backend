import { BusinessRuleViolation } from '../../../shared/domain/errors';
import {
  changeQuote,
  chosenActivityNames,
  colombiaToday,
  httpsUrl,
  newQuoteRequest,
  type QuoteInput,
  quoteSummary,
  validateActivity,
  validateQuote,
  validateVenueSettings,
  EMPTY_VENUE_SETTINGS,
} from './venue';

// 22 de noviembre de 2026, 23:30 en Colombia (ya es 23 en UTC).
const NOW = new Date('2026-11-23T04:30:00Z');

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    if (error instanceof BusinessRuleViolation) return error.code;
    throw error;
  }
  return undefined;
};

const base: QuoteInput = {
  kind: 'GROUP_VISIT',
  name: '  Colegio San José  ',
  email: 'Profe@Colegio.EDU.co',
  phone: '300 000 0000',
  people: 40,
  acceptPrivacy: true,
};

describe('validateQuote', () => {
  it('exige aceptar el tratamiento de datos', () => {
    expect(codeOf(() => validateQuote({ ...base, acceptPrivacy: false }, NOW))).toBe(
      'CONSENT_REQUIRED',
    );
  });

  it('normaliza nombre y correo y exige un correo válido y teléfono', () => {
    const valid = validateQuote(base, NOW);
    expect(valid).toMatchObject({
      name: 'Colegio San José',
      email: 'profe@colegio.edu.co',
      includesFood: false,
      activityIds: [],
    });
    expect(codeOf(() => validateQuote({ ...base, email: 'no-es-correo' }, NOW))).toBe(
      'INVALID_EMAIL',
    );
    expect(codeOf(() => validateQuote({ ...base, phone: '   ' }, NOW))).toBe('INVALID_FIELD');
    expect(codeOf(() => validateQuote({ ...base, phone: '1'.repeat(31) }, NOW))).toBe(
      'INVALID_FIELD',
    );
  });

  it('EVENT exige fecha y personas', () => {
    const event: QuoteInput = { ...base, kind: 'EVENT', people: null };
    expect(codeOf(() => validateQuote({ ...event, people: 30 }, NOW))).toBe('EVENT_DATE_REQUIRED');
    expect(codeOf(() => validateQuote({ ...event, eventDate: '2026-12-20' }, NOW))).toBe(
      'PEOPLE_REQUIRED',
    );
    expect(validateQuote({ ...event, eventDate: '2026-12-20', people: 30 }, NOW)).toMatchObject({
      kind: 'EVENT',
      eventDate: '2026-12-20',
      people: 30,
    });
  });

  it('GROUP_VISIT exige personas, la fecha es opcional', () => {
    expect(codeOf(() => validateQuote({ ...base, people: undefined }, NOW))).toBe(
      'PEOPLE_REQUIRED',
    );
    expect(validateQuote(base, NOW).eventDate).toBeNull();
  });

  it('COURT_RENTAL exige fecha, hora de inicio y duración', () => {
    const court: QuoteInput = {
      ...base,
      kind: 'COURT_RENTAL',
      people: null,
      eventDate: '2026-11-28',
      startTime: '16:00',
      durationHours: 2,
    };
    expect(validateQuote(court, NOW)).toMatchObject({
      startTime: '16:00',
      durationHours: 2,
      people: null,
    });
    expect(codeOf(() => validateQuote({ ...court, eventDate: null }, NOW))).toBe(
      'EVENT_DATE_REQUIRED',
    );
    expect(codeOf(() => validateQuote({ ...court, startTime: '' }, NOW))).toBe(
      'START_TIME_REQUIRED',
    );
    expect(codeOf(() => validateQuote({ ...court, durationHours: undefined }, NOW))).toBe(
      'DURATION_REQUIRED',
    );
    expect(codeOf(() => validateQuote({ ...court, durationHours: 13 }, NOW))).toBe(
      'INVALID_DURATION',
    );
  });

  it('la hora debe ser HH:MM entre 00:00 y 23:59', () => {
    const court: QuoteInput = {
      ...base,
      kind: 'COURT_RENTAL',
      eventDate: '2026-11-28',
      durationHours: 1,
    };
    for (const ok of ['00:00', '09:30', '23:59']) {
      expect(validateQuote({ ...court, startTime: ok }, NOW).startTime).toBe(ok);
    }
    for (const bad of ['24:00', '9:30', '12:60', '12-30', 'mediodía']) {
      expect(codeOf(() => validateQuote({ ...court, startTime: bad }, NOW))).toBe(
        'INVALID_START_TIME',
      );
    }
  });

  it('no admite fechas anteriores a hoy en Colombia (sí hoy)', () => {
    expect(colombiaToday(NOW)).toBe('2026-11-22');
    expect(validateQuote({ ...base, eventDate: '2026-11-22' }, NOW).eventDate).toBe('2026-11-22');
    expect(codeOf(() => validateQuote({ ...base, eventDate: '2026-11-21' }, NOW))).toBe(
      'EVENT_DATE_IN_PAST',
    );
  });

  it('rechaza fechas mal formadas o que no existen', () => {
    for (const bad of ['2026-02-30', '20-12-2026', '2026-13-01', 'mañana']) {
      expect(codeOf(() => validateQuote({ ...base, eventDate: bad }, NOW))).toBe(
        'INVALID_EVENT_DATE',
      );
    }
  });

  it('quita actividades repetidas y admite hasta 10', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `id-${i}`);
    expect(validateQuote({ ...base, activityIds: ['a', 'a', 'b'] }, NOW).activityIds).toEqual([
      'a',
      'b',
    ]);
    expect(codeOf(() => validateQuote({ ...base, activityIds: ids }, NOW))).toBe(
      'TOO_MANY_ACTIVITIES',
    );
  });
});

describe('chosenActivityNames', () => {
  const found = [
    { id: 'a', name: 'Banquitas', isPublished: true },
    { id: 'b', name: 'Voleibol', isPublished: false },
  ];

  it('copia los nombres en el orden elegido', () => {
    expect(chosenActivityNames(['a'], found)).toEqual(['Banquitas']);
  });

  it('rechaza actividades no publicadas o inexistentes', () => {
    expect(codeOf(() => chosenActivityNames(['b'], found))).toBe('ACTIVITY_NOT_AVAILABLE');
    expect(codeOf(() => chosenActivityNames(['zzz'], found))).toBe('ACTIVITY_NOT_AVAILABLE');
  });
});

describe('cotización guardada', () => {
  const quote = newQuoteRequest(
    validateQuote({ ...base, includesFood: true, message: 'Somos 40 niños' }, NOW),
    ['Comida', 'Banquitas'],
    '2026-11',
    NOW,
  );

  it('nace como NEW con consentimiento y versión de la política', () => {
    expect(quote).toMatchObject({
      status: 'NEW',
      consentAt: NOW,
      policyVersion: '2026-11',
      activityNames: ['Comida', 'Banquitas'],
      adminNotes: null,
    });
    expect(quote).not.toHaveProperty('activityIds');
  });

  it('cambia estado y notas', () => {
    const later = new Date(NOW.getTime() + 1000);
    const next = changeQuote(quote, { status: 'QUOTED', adminNotes: '  Enviada  ' }, later);
    expect(next).toMatchObject({ status: 'QUOTED', adminNotes: 'Enviada', updatedAt: later });
    expect(changeQuote(next, { adminNotes: null }, later).adminNotes).toBeNull();
    expect(changeQuote(next, {}, later).adminNotes).toBe('Enviada');
  });

  it('resume la solicitud para los correos', () => {
    const text = quoteSummary(quote);
    expect(text).toContain('Visita de grupo');
    expect(text).toContain('Personas: 40');
    expect(text).toContain('Actividades: Comida, Banquitas');
    expect(text).toContain('Incluye comida: sí');
    expect(text).toContain('Somos 40 niños');
  });
});

describe('ajustes y actividades', () => {
  it('el mapa solo admite https', () => {
    expect(httpsUrl('https://maps.example.com/x', 'mapa')).toBe('https://maps.example.com/x');
    expect(codeOf(() => httpsUrl('http://maps.example.com', 'mapa'))).toBe('INVALID_LINK');
    expect(codeOf(() => httpsUrl('/visitanos', 'mapa'))).toBe('INVALID_LINK');
    expect(
      codeOf(() =>
        validateVenueSettings({ ...EMPTY_VENUE_SETTINGS, mapUrl: 'javascript:alert(1)' }),
      ),
    ).toBe('INVALID_LINK');
  });

  it('limita las longitudes de los ajustes', () => {
    expect(
      codeOf(() => validateVenueSettings({ ...EMPTY_VENUE_SETTINGS, quoteNote: 'x'.repeat(301) })),
    ).toBe('INVALID_FIELD');
    expect(validateVenueSettings({ ...EMPTY_VENUE_SETTINGS, title: '  ' }).title).toBeNull();
  });

  it('una actividad necesita nombre', () => {
    const input = {
      name: ' Ping pong ',
      description: '',
      imageAlt: null,
      isPublished: true,
      sortOrder: 0,
    };
    expect(validateActivity(input)).toMatchObject({ name: 'Ping pong', description: null });
    expect(codeOf(() => validateActivity({ ...input, name: '' }))).toBe('INVALID_FIELD');
    expect(codeOf(() => validateActivity({ ...input, sortOrder: -1 }))).toBe('INVALID_ORDER');
  });
});
