import { BusinessRuleViolation } from '../../../shared/domain/errors';
import { normalizeEmail, optionalText, text } from '../../content/domain/content';

/** «El lugar»: actividades, ajustes de la página «Visítanos» y cotizaciones. Reglas puras. */

function order(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new BusinessRuleViolation('El orden debe ser un entero entre 0 y 10000', 'INVALID_ORDER');
  }
  return value;
}

/** Solo URLs https (el enlace al mapa se abre fuera de la tienda). */
export function httpsUrl(
  value: string | null | undefined,
  field: string,
  max = 500,
): string | null {
  const link = optionalText(value, field, max);
  if (!link) return null;
  try {
    const url = new URL(link);
    if (url.protocol === 'https:') return url.toString();
  } catch {
    // cae al error
  }
  throw new BusinessRuleViolation(`El campo ${field} debe ser una URL https`, 'INVALID_LINK', {
    field,
  });
}

/* ---------- Ajustes de «Visítanos» ---------- */

export interface VenueSettings {
  title: string | null;
  /** Markdown limitado, como las páginas. */
  intro: string | null;
  /** Texto libre, varias líneas. */
  schedule: string | null;
  address: string | null;
  mapUrl: string | null;
  /** Nota corta junto al formulario y en el correo de confirmación. */
  quoteNote: string | null;
}

export const EMPTY_VENUE_SETTINGS: VenueSettings = {
  title: null,
  intro: null,
  schedule: null,
  address: null,
  mapUrl: null,
  quoteNote: null,
};

export function validateVenueSettings(input: VenueSettings): VenueSettings {
  return {
    title: optionalText(input.title, 'título', 120),
    intro: optionalText(input.intro, 'presentación', 6000),
    schedule: optionalText(input.schedule, 'horario', 1000),
    address: optionalText(input.address, 'dirección', 200),
    mapUrl: httpsUrl(input.mapUrl, 'enlace del mapa'),
    quoteNote: optionalText(input.quoteNote, 'nota de cotización', 300),
  };
}

/* ---------- Actividades ---------- */

export const MAX_ACTIVITIES = 30;

/** GAME: se puede alquilar por horas (canchas, mesas). FOOD: se pide con la casilla de comida. */
export const ACTIVITY_KINDS = ['GAME', 'FOOD', 'OTHER'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface VenueActivityProps {
  id: string;
  name: string;
  kind: ActivityKind;
  description: string | null;
  imageUrl: string | null;
  imageKey: string | null;
  imageAlt: string | null;
  isPublished: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type VenueActivityInput = Pick<
  VenueActivityProps,
  'name' | 'kind' | 'description' | 'imageAlt' | 'isPublished' | 'sortOrder'
>;

export function validateActivity(input: VenueActivityInput): VenueActivityInput {
  if (!ACTIVITY_KINDS.includes(input.kind)) {
    throw new BusinessRuleViolation('Tipo de actividad no válido', 'INVALID_ACTIVITY_KIND');
  }
  return {
    name: text(input.name, 'nombre', 80),
    kind: input.kind,
    description: optionalText(input.description, 'descripción', 600),
    imageAlt: optionalText(input.imageAlt, 'texto alternativo', 200),
    isPublished: input.isPublished,
    sortOrder: order(input.sortOrder),
  };
}

/* ---------- Cotizaciones ---------- */

export const QUOTE_KINDS = ['EVENT', 'GROUP_VISIT', 'COURT_RENTAL'] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];

export const QUOTE_STATUSES = ['NEW', 'IN_PROGRESS', 'QUOTED', 'CLOSED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_KIND_LABELS: Record<QuoteKind, string> = {
  EVENT: 'Evento o celebración',
  GROUP_VISIT: 'Visita de grupo',
  COURT_RENTAL: 'Alquiler de cancha',
};

export const MAX_QUOTE_ACTIVITIES = 10;

export interface QuoteRequestProps {
  id: string;
  kind: QuoteKind;
  name: string;
  email: string;
  phone: string;
  /** "YYYY-MM-DD" (día de Colombia). */
  eventDate: string | null;
  /** "HH:MM". */
  startTime: string | null;
  durationHours: number | null;
  people: number | null;
  activityNames: string[];
  includesFood: boolean;
  message: string | null;
  consentAt: Date;
  policyVersion: string | null;
  status: QuoteStatus;
  adminNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteInput {
  kind: QuoteKind;
  name: string;
  email: string;
  phone: string;
  eventDate?: string | null;
  startTime?: string | null;
  durationHours?: number | null;
  people?: number | null;
  activityIds?: string[] | null;
  includesFood?: boolean | null;
  message?: string | null;
  acceptPrivacy: boolean;
}

/** Datos de la solicitud ya validados (las actividades se resuelven aparte). */
export type ValidQuote = Omit<
  QuoteRequestProps,
  | 'id'
  | 'activityNames'
  | 'consentAt'
  | 'policyVersion'
  | 'status'
  | 'adminNotes'
  | 'createdAt'
  | 'updatedAt'
> & { activityIds: string[] };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const COLOMBIA_OFFSET_MS = 5 * 3_600_000;

/** Día de hoy en Colombia (UTC−5, sin horario de verano) como "YYYY-MM-DD". */
export function colombiaToday(now: Date): string {
  return new Date(now.getTime() - COLOMBIA_OFFSET_MS).toISOString().slice(0, 10);
}

function calendarDate(value: string): string {
  const match = DATE.exec(value);
  const parsed = match ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BusinessRuleViolation(
      'La fecha debe tener la forma AAAA-MM-DD',
      'INVALID_EVENT_DATE',
    );
  }
  return value;
}

function whole(
  value: number | null | undefined,
  min: number,
  max: number,
  code: string,
  label: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new BusinessRuleViolation(`${label} debe ser un entero entre ${min} y ${max}`, code);
  }
  return value;
}

function required(kind: QuoteKind, field: string, code: string, label: string): never {
  throw new BusinessRuleViolation(
    `Para ${QUOTE_KIND_LABELS[kind].toLowerCase()} indica ${label}`,
    code,
    { field, kind },
  );
}

/**
 * Valida una solicitud de cotización:
 * - consentimiento obligatorio (Ley 1581), correo válido y teléfono;
 * - la fecha no puede ser anterior a hoy en Colombia;
 * - EVENT exige fecha y personas; GROUP_VISIT, personas; COURT_RENTAL, fecha, hora y duración.
 */
export function validateQuote(input: QuoteInput, now: Date): ValidQuote {
  if (!input.acceptPrivacy) {
    throw new BusinessRuleViolation('Debes aceptar el tratamiento de datos', 'CONSENT_REQUIRED');
  }
  if (!QUOTE_KINDS.includes(input.kind)) {
    throw new BusinessRuleViolation('Tipo de cotización no válido', 'INVALID_QUOTE_KIND');
  }
  const kind = input.kind;
  const name = text(input.name, 'nombre', 120);
  const email = normalizeEmail(input.email);
  const phone = text(input.phone ?? '', 'teléfono', 30);

  const rawDate = input.eventDate?.trim() || null;
  const eventDate = rawDate ? calendarDate(rawDate) : null;
  if (eventDate && eventDate < colombiaToday(now)) {
    throw new BusinessRuleViolation('La fecha no puede ser anterior a hoy', 'EVENT_DATE_IN_PAST');
  }

  const rawTime = input.startTime?.trim() || null;
  if (rawTime && !TIME.test(rawTime)) {
    throw new BusinessRuleViolation(
      'La hora debe tener la forma HH:MM (00:00 a 23:59)',
      'INVALID_START_TIME',
    );
  }
  const startTime = rawTime;
  const durationHours = whole(input.durationHours, 1, 12, 'INVALID_DURATION', 'La duración');
  const people = whole(input.people, 1, 2000, 'INVALID_PEOPLE', 'El número de personas');

  const activityIds = [...new Set(input.activityIds ?? [])];
  if (activityIds.length > MAX_QUOTE_ACTIVITIES) {
    throw new BusinessRuleViolation(
      `Puedes elegir hasta ${MAX_QUOTE_ACTIVITIES} actividades`,
      'TOO_MANY_ACTIVITIES',
    );
  }

  if (kind === 'EVENT' || kind === 'COURT_RENTAL') {
    if (!eventDate) required(kind, 'eventDate', 'EVENT_DATE_REQUIRED', 'la fecha');
  }
  if (kind === 'EVENT' || kind === 'GROUP_VISIT') {
    if (people === null) required(kind, 'people', 'PEOPLE_REQUIRED', 'cuántas personas vienen');
  }
  if (kind === 'COURT_RENTAL') {
    if (!startTime) required(kind, 'startTime', 'START_TIME_REQUIRED', 'la hora de inicio');
    if (durationHours === null) {
      required(kind, 'durationHours', 'DURATION_REQUIRED', 'cuántas horas');
    }
  }

  return {
    kind,
    name,
    email,
    phone,
    eventDate,
    startTime,
    durationHours,
    people,
    activityIds,
    includesFood: input.includesFood ?? false,
    message: optionalText(input.message, 'mensaje', 2000),
  };
}

/**
 * Las actividades elegidas deben existir y estar publicadas; se guardan sus nombres.
 * En un alquiler de cancha solo se eligen juegos: la comida no se alquila por horas.
 */
export function chosenActivityNames(
  ids: string[],
  found: Pick<VenueActivityProps, 'id' | 'name' | 'isPublished' | 'kind'>[],
  quoteKind: QuoteKind,
): string[] {
  const byId = new Map(found.map((a) => [a.id, a]));
  const missing = ids.filter((id) => !byId.get(id)?.isPublished);
  if (missing.length > 0) {
    throw new BusinessRuleViolation(
      'Alguna de las actividades elegidas ya no está disponible',
      'ACTIVITY_NOT_AVAILABLE',
      { activityIds: missing },
    );
  }
  if (quoteKind === 'COURT_RENTAL') {
    const notGames = ids.filter((id) => byId.get(id)!.kind !== 'GAME');
    if (notGames.length > 0) {
      throw new BusinessRuleViolation(
        'En un alquiler de cancha solo se eligen juegos',
        'ACTIVITY_NOT_RENTABLE',
        { activityIds: notGames },
      );
    }
  }
  return ids.map((id) => byId.get(id)!.name);
}

export function newQuoteRequest(
  valid: ValidQuote,
  activityNames: string[],
  policyVersion: string | null,
  now: Date,
): QuoteRequestProps {
  const { activityIds: _ids, ...data } = valid;
  return {
    id: crypto.randomUUID(),
    ...data,
    activityNames,
    consentAt: now,
    policyVersion,
    status: 'NEW',
    adminNotes: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface QuoteChanges {
  status?: QuoteStatus;
  adminNotes?: string | null;
}

export function changeQuote(
  quote: QuoteRequestProps,
  changes: QuoteChanges,
  now: Date,
): QuoteRequestProps {
  if (changes.status !== undefined && !QUOTE_STATUSES.includes(changes.status)) {
    throw new BusinessRuleViolation('Estado no válido', 'INVALID_QUOTE_STATUS');
  }
  return {
    ...quote,
    status: changes.status ?? quote.status,
    adminNotes:
      changes.adminNotes === undefined
        ? quote.adminNotes
        : optionalText(changes.adminNotes, 'notas', 2000),
    updatedAt: now,
  };
}

/** Resumen en texto para los correos (a la tienda y a quien pide la cotización). */
export function quoteSummary(quote: QuoteRequestProps): string {
  const lines = [
    `Tipo: ${QUOTE_KIND_LABELS[quote.kind]}`,
    `Nombre: ${quote.name}`,
    `Correo: ${quote.email}`,
    `Teléfono: ${quote.phone}`,
  ];
  if (quote.eventDate) lines.push(`Fecha: ${quote.eventDate}`);
  if (quote.startTime) lines.push(`Hora de inicio: ${quote.startTime}`);
  if (quote.durationHours !== null) {
    lines.push(`Duración: ${quote.durationHours} ${quote.durationHours === 1 ? 'hora' : 'horas'}`);
  }
  if (quote.people !== null) lines.push(`Personas: ${quote.people}`);
  if (quote.activityNames.length > 0) lines.push(`Actividades: ${quote.activityNames.join(', ')}`);
  lines.push(`Incluye comida: ${quote.includesFood ? 'sí' : 'no'}`);
  if (quote.message) lines.push('', 'Mensaje:', quote.message);
  return lines.join('\n');
}
