import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../../../shared/application/actor';
import { AUDIT_TRAIL, type AuditTrail } from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/application/email-sender';
import { IMAGE_STORAGE, type ImageStorage } from '../../../shared/application/image-storage';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, ConflictError, NotFoundError } from '../../../shared/domain/errors';
import { deleteImageQuietly, withUploadedImage } from '../../catalog/application/media';
import {
  type BannerInput,
  type BannerProps,
  type ContactMessageProps,
  type ContactStatus,
  EMPTY_SETTINGS,
  type FaqInput,
  type FaqProps,
  isBannerLive,
  newContactMessage,
  normalizeEmail,
  type PageInput,
  type PageProps,
  type StoreSettings,
  type TestimonialInput,
  type TestimonialProps,
  validateBanner,
  validateFaq,
  validatePage,
  validateSettings,
  validateTestimonial,
} from '../domain/content';

/* ---------- Puertos ---------- */

export interface ContentRepository {
  listBanners(): Promise<BannerProps[]>;
  findBanner(id: string): Promise<BannerProps | null>;
  saveBanner(b: BannerProps): Promise<void>;
  deleteBanner(id: string): Promise<void>;

  listTestimonials(onlyPublished: boolean): Promise<TestimonialProps[]>;
  findTestimonial(id: string): Promise<TestimonialProps | null>;
  saveTestimonial(t: TestimonialProps): Promise<void>;
  deleteTestimonial(id: string): Promise<void>;

  listFaqs(onlyPublished: boolean): Promise<FaqProps[]>;
  findFaq(id: string): Promise<FaqProps | null>;
  saveFaq(f: FaqProps): Promise<void>;
  deleteFaq(id: string): Promise<void>;

  listPages(): Promise<PageProps[]>;
  findPage(id: string): Promise<PageProps | null>;
  findPageBySlug(slug: string): Promise<PageProps | null>;
  /** Lanza ConflictError si el slug ya existe en otra página. */
  savePage(p: PageProps): Promise<void>;
  deletePage(id: string): Promise<void>;

  getSettings(): Promise<StoreSettings | null>;
  saveSettings(s: StoreSettings): Promise<void>;
}
export const CONTENT_REPOSITORY = Symbol('ContentRepository');

export interface Subscriber {
  id: string;
  email: string;
  consentAt: Date;
  policyVersion: string | null;
  confirmedAt: Date | null;
  tokenHash: string | null;
  unsubscribedAt: Date | null;
  createdAt: Date;
}

export interface NewsletterRepository {
  findByEmail(email: string): Promise<Subscriber | null>;
  findByTokenHash(hash: string): Promise<Subscriber | null>;
  save(s: Subscriber): Promise<void>;
  list(query: {
    page: number;
    pageSize: number;
    onlyActive: boolean;
  }): Promise<{ items: Subscriber[]; total: number }>;
}
export const NEWSLETTER_REPOSITORY = Symbol('NewsletterRepository');

export interface ContactRepository {
  save(m: ContactMessageProps): Promise<void>;
  find(id: string): Promise<ContactMessageProps | null>;
  list(query: {
    status?: ContactStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: ContactMessageProps[]; total: number }>;
  countNew(): Promise<number>;
}
export const CONTACT_REPOSITORY = Symbol('ContactRepository');

export interface ContentSettings {
  storefrontUrl: string;
  privacyPolicyVersion: string;
  adminAlertEmails: string[];
}
export const CONTENT_SETTINGS = Symbol('ContentSettings');

/* ---------- Lectura pública ---------- */

@Injectable()
export class PublicContent {
  constructor(
    @Inject(CONTENT_REPOSITORY) private readonly repo: ContentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async banners(): Promise<BannerProps[]> {
    const now = this.clock.now();
    return (await this.repo.listBanners()).filter((b) => isBannerLive(b, now));
  }

  testimonials(): Promise<TestimonialProps[]> {
    return this.repo.listTestimonials(true);
  }

  faqs(): Promise<FaqProps[]> {
    return this.repo.listFaqs(true);
  }

  async page(slug: string): Promise<PageProps> {
    const page = await this.repo.findPageBySlug(slug.toLowerCase());
    if (!page?.isPublished) throw new NotFoundError('Página', slug);
    return page;
  }

  async settings(): Promise<StoreSettings> {
    return (await this.repo.getSettings()) ?? EMPTY_SETTINGS;
  }
}

/* ---------- Administración ---------- */

@Injectable()
export class ContentAdministration {
  constructor(
    @Inject(CONTENT_REPOSITORY) private readonly repo: ContentRepository,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Banners

  listBanners(): Promise<BannerProps[]> {
    return this.repo.listBanners();
  }

  /** El banner nace con su imagen: no hay banner sin foto. */
  createBanner(actor: Actor, input: BannerInput, image: Buffer): Promise<BannerProps> {
    const valid = validateBanner(input);
    return withUploadedImage(this.storage, image, 'banners', (stored) =>
      this.unitOfWork.execute(async () => {
        const banner: BannerProps = {
          id: crypto.randomUUID(),
          ...valid,
          imageUrl: stored.url,
          imageKey: stored.key,
        };
        await this.repo.saveBanner(banner);
        await this.record(actor, 'banner.created', 'Banner', banner.id);
        return banner;
      }),
    );
  }

  updateBanner(actor: Actor, id: string, changes: Partial<BannerInput>): Promise<BannerProps> {
    return this.unitOfWork.execute(async () => {
      const current = await this.requireBanner(id);
      const { id: _id, imageUrl, imageKey, ...rest } = current;
      const banner: BannerProps = {
        id,
        imageUrl,
        imageKey,
        ...validateBanner({ ...rest, ...changes }),
      };
      await this.repo.saveBanner(banner);
      await this.record(actor, 'banner.updated', 'Banner', id, { fields: Object.keys(changes) });
      return banner;
    });
  }

  async replaceBannerImage(actor: Actor, id: string, image: Buffer): Promise<BannerProps> {
    await this.requireBanner(id);
    let previous: string | null = null;
    const banner = await withUploadedImage(this.storage, image, 'banners', (stored) =>
      this.unitOfWork.execute(async () => {
        const current = await this.requireBanner(id);
        previous = current.imageKey;
        const next = { ...current, imageUrl: stored.url, imageKey: stored.key };
        await this.repo.saveBanner(next);
        await this.record(actor, 'banner.image_changed', 'Banner', id);
        return next;
      }),
    );
    if (previous) await deleteImageQuietly(this.storage, previous);
    return banner;
  }

  async deleteBanner(actor: Actor, id: string): Promise<void> {
    const current = await this.requireBanner(id);
    await this.unitOfWork.execute(async () => {
      await this.repo.deleteBanner(id);
      await this.record(actor, 'banner.deleted', 'Banner', id);
    });
    if (current.imageKey) await deleteImageQuietly(this.storage, current.imageKey);
  }

  private async requireBanner(id: string): Promise<BannerProps> {
    const b = await this.repo.findBanner(id);
    if (!b) throw new NotFoundError('Banner', id);
    return b;
  }

  // Testimonios

  listTestimonials(): Promise<TestimonialProps[]> {
    return this.repo.listTestimonials(false);
  }

  createTestimonial(actor: Actor, input: TestimonialInput): Promise<TestimonialProps> {
    return this.unitOfWork.execute(async () => {
      const t: TestimonialProps = {
        id: crypto.randomUUID(),
        createdAt: this.clock.now(),
        ...validateTestimonial(input),
      };
      await this.repo.saveTestimonial(t);
      await this.record(actor, 'testimonial.created', 'Testimonial', t.id);
      return t;
    });
  }

  updateTestimonial(
    actor: Actor,
    id: string,
    changes: Partial<TestimonialInput>,
  ): Promise<TestimonialProps> {
    return this.unitOfWork.execute(async () => {
      const current = await this.repo.findTestimonial(id);
      if (!current) throw new NotFoundError('Testimonio', id);
      const { id: _i, createdAt, ...rest } = current;
      const t: TestimonialProps = {
        id,
        createdAt,
        ...validateTestimonial({ ...rest, ...changes }),
      };
      await this.repo.saveTestimonial(t);
      await this.record(actor, 'testimonial.updated', 'Testimonial', id, {
        fields: Object.keys(changes),
      });
      return t;
    });
  }

  deleteTestimonial(actor: Actor, id: string): Promise<void> {
    return this.unitOfWork.execute(async () => {
      if (!(await this.repo.findTestimonial(id))) throw new NotFoundError('Testimonio', id);
      await this.repo.deleteTestimonial(id);
      await this.record(actor, 'testimonial.deleted', 'Testimonial', id);
    });
  }

  // Preguntas frecuentes

  listFaqs(): Promise<FaqProps[]> {
    return this.repo.listFaqs(false);
  }

  createFaq(actor: Actor, input: FaqInput): Promise<FaqProps> {
    return this.unitOfWork.execute(async () => {
      const f: FaqProps = { id: crypto.randomUUID(), ...validateFaq(input) };
      await this.repo.saveFaq(f);
      await this.record(actor, 'faq.created', 'Faq', f.id);
      return f;
    });
  }

  updateFaq(actor: Actor, id: string, changes: Partial<FaqInput>): Promise<FaqProps> {
    return this.unitOfWork.execute(async () => {
      const current = await this.repo.findFaq(id);
      if (!current) throw new NotFoundError('Pregunta', id);
      const { id: _i, ...rest } = current;
      const f: FaqProps = { id, ...validateFaq({ ...rest, ...changes }) };
      await this.repo.saveFaq(f);
      await this.record(actor, 'faq.updated', 'Faq', id, { fields: Object.keys(changes) });
      return f;
    });
  }

  deleteFaq(actor: Actor, id: string): Promise<void> {
    return this.unitOfWork.execute(async () => {
      if (!(await this.repo.findFaq(id))) throw new NotFoundError('Pregunta', id);
      await this.repo.deleteFaq(id);
      await this.record(actor, 'faq.deleted', 'Faq', id);
    });
  }

  // Páginas

  listPages(): Promise<PageProps[]> {
    return this.repo.listPages();
  }

  async getPage(id: string): Promise<PageProps> {
    const p = await this.repo.findPage(id);
    if (!p) throw new NotFoundError('Página', id);
    return p;
  }

  createPage(actor: Actor, input: PageInput): Promise<PageProps> {
    return this.unitOfWork.execute(async () => {
      const valid = validatePage(input);
      if (await this.repo.findPageBySlug(valid.slug)) {
        throw new ConflictError('Ya existe una página con ese slug', 'SLUG_TAKEN');
      }
      const now = this.clock.now();
      const page: PageProps = {
        id: crypto.randomUUID(),
        ...valid,
        publishedAt: valid.isPublished ? now : null,
        updatedAt: now,
      };
      await this.repo.savePage(page);
      await this.record(actor, 'page.created', 'Page', page.id, { slug: page.slug });
      return page;
    });
  }

  updatePage(actor: Actor, id: string, changes: Partial<PageInput>): Promise<PageProps> {
    return this.unitOfWork.execute(async () => {
      const current = await this.getPage(id);
      const valid = validatePage({ ...current, ...changes });
      const other = valid.slug !== current.slug ? await this.repo.findPageBySlug(valid.slug) : null;
      if (other) throw new ConflictError('Ya existe una página con ese slug', 'SLUG_TAKEN');
      const now = this.clock.now();
      const page: PageProps = {
        ...current,
        ...valid,
        publishedAt: valid.isPublished ? (current.publishedAt ?? now) : null,
        updatedAt: now,
      };
      await this.repo.savePage(page);
      await this.record(actor, 'page.updated', 'Page', id, { fields: Object.keys(changes) });
      return page;
    });
  }

  deletePage(actor: Actor, id: string): Promise<void> {
    return this.unitOfWork.execute(async () => {
      await this.getPage(id);
      await this.repo.deletePage(id);
      await this.record(actor, 'page.deleted', 'Page', id);
    });
  }

  // Ajustes

  async getSettings(): Promise<StoreSettings> {
    return (await this.repo.getSettings()) ?? EMPTY_SETTINGS;
  }

  saveSettings(actor: Actor, input: StoreSettings): Promise<StoreSettings> {
    return this.unitOfWork.execute(async () => {
      const settings = validateSettings(input);
      await this.repo.saveSettings(settings);
      await this.record(actor, 'store_settings.updated', 'StoreSetting', 'store');
      return settings;
    });
  }

  private record(
    actor: Actor,
    action: string,
    resource: string,
    id: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.record({
      actorId: actor.id,
      action,
      resource,
      resourceId: id,
      metadata,
      ipAddress: actor.context.ipAddress,
    });
  }
}

/* ---------- Boletín (doble confirmación) ---------- */

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class Newsletter {
  private readonly logger = new Logger(Newsletter.name);

  constructor(
    @Inject(NEWSLETTER_REPOSITORY) private readonly repo: NewsletterRepository,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONTENT_SETTINGS) private readonly settings: ContentSettings,
  ) {}

  /**
   * Siempre responde igual, exista o no el correo, para no revelar quién está suscrito.
   * Envía (o reenvía) el enlace de confirmación salvo que ya esté confirmado.
   */
  async subscribe(rawEmail: string, acceptedPrivacy: boolean): Promise<void> {
    if (!acceptedPrivacy) {
      throw new BusinessRuleViolation('Debes aceptar el tratamiento de datos', 'CONSENT_REQUIRED');
    }
    const email = normalizeEmail(rawEmail);
    const now = this.clock.now();
    const existing = await this.repo.findByEmail(email);
    if (existing?.confirmedAt && !existing.unsubscribedAt) return;
    const token = randomBytes(32).toString('base64url');
    await this.repo.save({
      id: existing?.id ?? crypto.randomUUID(),
      email,
      consentAt: now,
      policyVersion: this.settings.privacyPolicyVersion,
      confirmedAt: null,
      tokenHash: hashToken(token),
      unsubscribedAt: null,
      createdAt: existing?.createdAt ?? now,
    });
    const link = `${this.settings.storefrontUrl}/boletin/confirmar?token=${token}`;
    try {
      await this.email.send({
        to: email,
        subject: 'Confirma tu suscripción a Telar Casa Carrillo',
        text: `Hola.\n\nPara recibir un correo cuando haya piezas nuevas del telar, confirma aquí:\n${link}\n\nSi no fuiste tú, ignora este mensaje.`,
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'No se pudo enviar la confirmación del boletín');
    }
  }

  async confirm(token: string): Promise<void> {
    const sub = await this.repo.findByTokenHash(hashToken(token));
    if (!sub || sub.unsubscribedAt)
      throw new BusinessRuleViolation('El enlace no es válido', 'INVALID_TOKEN');
    if (!sub.confirmedAt) await this.repo.save({ ...sub, confirmedAt: this.clock.now() });
  }

  async unsubscribe(token: string): Promise<void> {
    const sub = await this.repo.findByTokenHash(hashToken(token));
    if (!sub) throw new BusinessRuleViolation('El enlace no es válido', 'INVALID_TOKEN');
    if (!sub.unsubscribedAt) await this.repo.save({ ...sub, unsubscribedAt: this.clock.now() });
  }

  list(query: { page: number; pageSize: number; onlyActive: boolean }) {
    return this.repo.list(query);
  }
}

/* ---------- Contacto ---------- */

@Injectable()
export class ContactInbox {
  private readonly logger = new Logger(ContactInbox.name);

  constructor(
    @Inject(CONTACT_REPOSITORY) private readonly repo: ContactRepository,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONTENT_SETTINGS) private readonly settings: ContentSettings,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  async receive(
    input: {
      name: string;
      email: string;
      phone?: string | null;
      subject?: string | null;
      message: string;
    },
    acceptedPrivacy: boolean,
  ): Promise<ContactMessageProps> {
    if (!acceptedPrivacy) {
      throw new BusinessRuleViolation('Debes aceptar el tratamiento de datos', 'CONSENT_REQUIRED');
    }
    const message = newContactMessage(input, this.clock.now());
    await this.repo.save(message);
    // Aviso a la tienda; si falla, el mensaje ya quedó guardado en el panel.
    for (const to of this.settings.adminAlertEmails) {
      try {
        await this.email.send({
          to,
          subject: `Nuevo mensaje de contacto: ${message.subject ?? message.name}`,
          text: `De: ${message.name} <${message.email}>${message.phone ? `\nTeléfono: ${message.phone}` : ''}\n\n${message.message}`,
        });
      } catch (error) {
        this.logger.warn({ err: error }, 'No se pudo avisar del mensaje de contacto');
      }
    }
    return message;
  }

  list(query: { status?: ContactStatus; page: number; pageSize: number }) {
    return this.repo.list(query);
  }

  countNew(): Promise<number> {
    return this.repo.countNew();
  }

  async setStatus(actor: Actor, id: string, status: ContactStatus): Promise<ContactMessageProps> {
    const m = await this.repo.find(id);
    if (!m) throw new NotFoundError('Mensaje', id);
    const next = { ...m, status };
    await this.repo.save(next);
    await this.audit.record({
      actorId: actor.id,
      action: 'contact_message.status_changed',
      resource: 'ContactMessage',
      resourceId: id,
      metadata: { status },
      ipAddress: actor.context.ipAddress,
    });
    return next;
  }
}
