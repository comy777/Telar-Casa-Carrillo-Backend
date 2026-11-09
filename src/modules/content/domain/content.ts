import { BusinessRuleViolation } from '../../../shared/domain/errors';

/** Contenido editable de la tienda: reglas puras, sin Nest ni Prisma. */

export function text(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new BusinessRuleViolation(
      `El campo ${field} es obligatorio y admite hasta ${max} caracteres`,
      'INVALID_FIELD',
      { field },
    );
  }
  return trimmed;
}

export function optionalText(
  value: string | null | undefined,
  field: string,
  max: number,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new BusinessRuleViolation(
      `El campo ${field} admite hasta ${max} caracteres`,
      'INVALID_FIELD',
      {
        field,
      },
    );
  }
  return trimmed;
}

function order(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new BusinessRuleViolation('El orden debe ser un entero entre 0 y 10000', 'INVALID_ORDER');
  }
  return value;
}

/** Solo rutas internas ("/productos") o URLs https; nada de javascript: ni data:. */
export function safeLink(value: string | null | undefined, field: string): string | null {
  const link = optionalText(value, field, 500);
  if (!link) return null;
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  try {
    const url = new URL(link);
    if (url.protocol === 'https:') return url.toString();
  } catch {
    // cae al error
  }
  throw new BusinessRuleViolation(
    `El campo ${field} debe ser una ruta de la tienda (/...) o una URL https`,
    'INVALID_LINK',
    { field },
  );
}

/* ---------- Banners ---------- */

export interface BannerProps {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  imageKey: string | null;
  imageAlt: string | null;
  targetUrl: string | null;
  ctaLabel: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
}

export type BannerInput = Omit<BannerProps, 'id' | 'imageUrl' | 'imageKey'>;

export function validateBanner(input: BannerInput): BannerInput {
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    throw new BusinessRuleViolation(
      'La fecha final debe ser posterior a la inicial',
      'INVALID_DATES',
    );
  }
  const targetUrl = safeLink(input.targetUrl, 'enlace');
  const ctaLabel = optionalText(input.ctaLabel, 'texto del botón', 40);
  if (ctaLabel && !targetUrl) {
    throw new BusinessRuleViolation('Un botón necesita un enlace', 'CTA_WITHOUT_LINK');
  }
  return {
    ...input,
    title: text(input.title, 'título', 120),
    subtitle: optionalText(input.subtitle, 'subtítulo', 240),
    imageAlt: optionalText(input.imageAlt, 'texto alternativo', 200),
    targetUrl,
    ctaLabel,
    sortOrder: order(input.sortOrder),
  };
}

/** Vigente: activo y dentro de sus fechas (si las tiene). */
export function isBannerLive(banner: BannerProps, now: Date): boolean {
  if (!banner.isActive) return false;
  if (banner.startsAt && banner.startsAt > now) return false;
  if (banner.endsAt && banner.endsAt <= now) return false;
  return true;
}

/* ---------- Testimonios ---------- */

export interface TestimonialProps {
  id: string;
  customerName: string;
  location: string | null;
  content: string;
  rating: number | null;
  isPublished: boolean;
  sortOrder: number;
  createdAt: Date;
}

export type TestimonialInput = Omit<TestimonialProps, 'id' | 'createdAt'>;

export function validateTestimonial(input: TestimonialInput): TestimonialInput {
  if (
    input.rating !== null &&
    (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
  ) {
    throw new BusinessRuleViolation('La calificación va de 1 a 5', 'INVALID_RATING');
  }
  return {
    ...input,
    customerName: text(input.customerName, 'nombre', 80),
    location: optionalText(input.location, 'ciudad', 80),
    content: text(input.content, 'testimonio', 800),
    sortOrder: order(input.sortOrder),
  };
}

/* ---------- Preguntas frecuentes ---------- */

export interface FaqProps {
  id: string;
  question: string;
  answer: string;
  isPublished: boolean;
  sortOrder: number;
}

export type FaqInput = Omit<FaqProps, 'id'>;

export function validateFaq(input: FaqInput): FaqInput {
  return {
    ...input,
    question: text(input.question, 'pregunta', 200),
    answer: text(input.answer, 'respuesta', 4000),
    sortOrder: order(input.sortOrder),
  };
}

/* ---------- Páginas (políticas, nosotros...) ---------- */

export const PAGE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PageProps {
  id: string;
  slug: string;
  title: string;
  /** Markdown limitado: títulos, párrafos, listas, negrita y enlaces. */
  body: string;
  isPublished: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
}

export type PageInput = Pick<PageProps, 'slug' | 'title' | 'body' | 'isPublished'>;

export function validatePage(input: PageInput): PageInput {
  const slug = text(input.slug, 'slug', 80).toLowerCase();
  if (!PAGE_SLUG.test(slug)) {
    throw new BusinessRuleViolation(
      'El slug solo admite minúsculas, números y guiones',
      'INVALID_SLUG',
    );
  }
  return {
    ...input,
    slug,
    title: text(input.title, 'título', 120),
    body: text(input.body, 'contenido', 60_000),
  };
}

/* ---------- Ajustes de la tienda ---------- */

export interface SocialLink {
  name: string;
  url: string;
}

/** Ajustes públicos: lo que el storefront muestra en el pie, el inicio y el contacto. */
export interface StoreSettings {
  storeName: string | null;
  tagline: string | null;
  location: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  whatsapp: string | null;
  socialLinks: SocialLink[];
  storyTitle: string | null;
  storyBody: string | null;
  announcement: string | null;
}

export const EMPTY_SETTINGS: StoreSettings = {
  storeName: null,
  tagline: null,
  location: null,
  contactEmail: null,
  contactPhone: null,
  whatsapp: null,
  socialLinks: [],
  storyTitle: null,
  storyBody: null,
  announcement: null,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSettings(input: StoreSettings): StoreSettings {
  const contactEmail = optionalText(input.contactEmail, 'correo de contacto', 200);
  if (contactEmail && !EMAIL.test(contactEmail)) {
    throw new BusinessRuleViolation('El correo de contacto no es válido', 'INVALID_EMAIL');
  }
  if (input.socialLinks.length > 8) {
    throw new BusinessRuleViolation('Puedes agregar hasta 8 redes', 'TOO_MANY_LINKS');
  }
  return {
    storeName: optionalText(input.storeName, 'nombre de la tienda', 80),
    tagline: optionalText(input.tagline, 'descripción corta', 200),
    location: optionalText(input.location, 'ubicación', 120),
    contactEmail,
    contactPhone: optionalText(input.contactPhone, 'teléfono', 30),
    whatsapp: optionalText(input.whatsapp?.replace(/[^\d+]/g, ''), 'WhatsApp', 20),
    socialLinks: input.socialLinks.map((l) => ({
      name: text(l.name, 'nombre de la red', 40),
      url: safeLink(l.url, 'enlace de la red') ?? '',
    })),
    storyTitle: optionalText(input.storyTitle, 'título de la historia', 120),
    storyBody: optionalText(input.storyBody, 'historia', 6000),
    announcement: optionalText(input.announcement, 'aviso', 160),
  };
}

/* ---------- Contacto ---------- */

export type ContactStatus = 'NEW' | 'READ' | 'ARCHIVED';

export interface ContactMessageProps {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  consentAt: Date;
  status: ContactStatus;
  createdAt: Date;
}

export function newContactMessage(
  input: {
    name: string;
    email: string;
    phone?: string | null;
    subject?: string | null;
    message: string;
  },
  now: Date,
): ContactMessageProps {
  const email = text(input.email, 'correo', 200).toLowerCase();
  if (!EMAIL.test(email))
    throw new BusinessRuleViolation('El correo no es válido', 'INVALID_EMAIL');
  return {
    id: crypto.randomUUID(),
    name: text(input.name, 'nombre', 120),
    email,
    phone: optionalText(input.phone, 'teléfono', 30),
    subject: optionalText(input.subject, 'asunto', 160),
    message: text(input.message, 'mensaje', 4000),
    consentAt: now,
    status: 'NEW',
    createdAt: now,
  };
}

export function normalizeEmail(value: string): string {
  const email = text(value, 'correo', 200).toLowerCase();
  if (!EMAIL.test(email))
    throw new BusinessRuleViolation('El correo no es válido', 'INVALID_EMAIL');
  return email;
}

/* ---------- Navegación del storefront ---------- */

export const FOOTER_GROUPS = ['SHOP', 'HELP', 'INFO'] as const;
export type FooterGroup = (typeof FOOTER_GROUPS)[number];

/**
 * Una ruta del storefront. El catálogo (clave y prefijo) lo fija el código de la tienda;
 * desde el panel se edita si está activa, su texto y dónde aparece en el menú y el pie.
 */
export interface StoreRouteProps {
  key: string;
  path: string;
  label: string;
  description: string | null;
  isEnabled: boolean;
  isLocked: boolean;
  showInHeader: boolean;
  footerGroup: FooterGroup | null;
  sortOrder: number;
  updatedAt: Date;
}

export type StoreRouteChanges = Partial<
  Pick<StoreRouteProps, 'label' | 'isEnabled' | 'showInHeader' | 'footerGroup' | 'sortOrder'>
>;

export function changeStoreRoute(
  route: StoreRouteProps,
  changes: StoreRouteChanges,
  now: Date,
): StoreRouteProps {
  const next = { ...route, ...changes };
  if (route.isLocked && !next.isEnabled) {
    throw new BusinessRuleViolation(
      `La ruta "${route.label}" no se puede desactivar`,
      'ROUTE_LOCKED',
      { key: route.key },
    );
  }
  if (next.footerGroup !== null && !FOOTER_GROUPS.includes(next.footerGroup)) {
    throw new BusinessRuleViolation('Columna del pie no válida', 'INVALID_FOOTER_GROUP');
  }
  return {
    ...next,
    label: text(next.label, 'texto del enlace', 40),
    sortOrder: order(next.sortOrder),
    updatedAt: now,
  };
}
