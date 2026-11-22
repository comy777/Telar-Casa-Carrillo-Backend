import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../../../shared/application/actor';
import { AUDIT_TRAIL, type AuditTrail } from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/application/email-sender';
import { IMAGE_STORAGE, type ImageStorage } from '../../../shared/application/image-storage';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import { deleteImageQuietly, withUploadedImage } from '../../catalog/application/media';
import {
  changeQuote,
  chosenActivityNames,
  EMPTY_VENUE_SETTINGS,
  MAX_ACTIVITIES,
  newQuoteRequest,
  QUOTE_KIND_LABELS,
  type QuoteChanges,
  type QuoteInput,
  type QuoteKind,
  type QuoteRequestProps,
  quoteSummary,
  type QuoteStatus,
  validateActivity,
  validateQuote,
  validateVenueSettings,
  type VenueActivityInput,
  type VenueActivityProps,
  type VenueSettings,
} from '../domain/venue';

/* ---------- Puertos ---------- */

export interface VenueRepository {
  getSettings(): Promise<VenueSettings | null>;
  saveSettings(s: VenueSettings): Promise<void>;

  /** Ordenadas por sortOrder y nombre. */
  listActivities(onlyPublished: boolean): Promise<VenueActivityProps[]>;
  findActivities(ids: string[]): Promise<VenueActivityProps[]>;
  findActivity(id: string): Promise<VenueActivityProps | null>;
  countActivities(): Promise<number>;
  saveActivity(a: VenueActivityProps): Promise<void>;
  deleteActivity(id: string): Promise<void>;
}
export const VENUE_REPOSITORY = Symbol('VenueRepository');

export interface QuoteQuery {
  status?: QuoteStatus;
  kind?: QuoteKind;
  page: number;
  pageSize: number;
}

export interface QuoteRepository {
  save(q: QuoteRequestProps): Promise<void>;
  find(id: string): Promise<QuoteRequestProps | null>;
  /** Más recientes primero. */
  list(query: QuoteQuery): Promise<{ items: QuoteRequestProps[]; total: number }>;
}
export const QUOTE_REPOSITORY = Symbol('QuoteRepository');

export interface VenueConfig {
  privacyPolicyVersion: string;
  adminAlertEmails: string[];
}
export const VENUE_CONFIG = Symbol('VenueConfig');

/* ---------- Lectura pública ---------- */

@Injectable()
export class PublicVenue {
  constructor(@Inject(VENUE_REPOSITORY) private readonly repo: VenueRepository) {}

  async page(): Promise<{ settings: VenueSettings; activities: VenueActivityProps[] }> {
    const [settings, activities] = await Promise.all([
      this.repo.getSettings(),
      this.repo.listActivities(true),
    ]);
    return { settings: settings ?? EMPTY_VENUE_SETTINGS, activities };
  }
}

/* ---------- Administración del lugar ---------- */

@Injectable()
export class VenueAdministration {
  constructor(
    @Inject(VENUE_REPOSITORY) private readonly repo: VenueRepository,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Ajustes

  async getSettings(): Promise<VenueSettings> {
    return (await this.repo.getSettings()) ?? EMPTY_VENUE_SETTINGS;
  }

  saveSettings(actor: Actor, input: VenueSettings): Promise<VenueSettings> {
    return this.unitOfWork.execute(async () => {
      const settings = validateVenueSettings(input);
      await this.repo.saveSettings(settings);
      await this.record(actor, 'venue_settings.updated', 'StoreSetting', 'venue');
      return settings;
    });
  }

  // Actividades

  listActivities(): Promise<VenueActivityProps[]> {
    return this.repo.listActivities(false);
  }

  createActivity(actor: Actor, input: VenueActivityInput): Promise<VenueActivityProps> {
    return this.unitOfWork.execute(async () => {
      const valid = validateActivity(input);
      if ((await this.repo.countActivities()) >= MAX_ACTIVITIES) {
        throw new BusinessRuleViolation(
          `Puedes tener hasta ${MAX_ACTIVITIES} actividades`,
          'TOO_MANY_ACTIVITIES',
        );
      }
      const now = this.clock.now();
      const activity: VenueActivityProps = {
        id: crypto.randomUUID(),
        ...valid,
        imageUrl: null,
        imageKey: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.repo.saveActivity(activity);
      await this.record(actor, 'venue_activity.created', 'VenueActivity', activity.id);
      return activity;
    });
  }

  updateActivity(
    actor: Actor,
    id: string,
    changes: Partial<VenueActivityInput>,
  ): Promise<VenueActivityProps> {
    return this.unitOfWork.execute(async () => {
      const current = await this.requireActivity(id);
      const activity: VenueActivityProps = {
        ...current,
        ...validateActivity({ ...current, ...changes }),
        updatedAt: this.clock.now(),
      };
      await this.repo.saveActivity(activity);
      await this.record(actor, 'venue_activity.updated', 'VenueActivity', id, {
        fields: Object.keys(changes),
      });
      return activity;
    });
  }

  /** Reemplaza la imagen y borra la anterior. */
  async replaceActivityImage(actor: Actor, id: string, image: Buffer): Promise<VenueActivityProps> {
    await this.requireActivity(id);
    let previous: string | null = null;
    const activity = await withUploadedImage(this.storage, image, 'venue', (stored) =>
      this.unitOfWork.execute(async () => {
        const current = await this.requireActivity(id);
        previous = current.imageKey;
        const next: VenueActivityProps = {
          ...current,
          imageUrl: stored.url,
          imageKey: stored.key,
          updatedAt: this.clock.now(),
        };
        await this.repo.saveActivity(next);
        await this.record(actor, 'venue_activity.image_changed', 'VenueActivity', id);
        return next;
      }),
    );
    if (previous) await deleteImageQuietly(this.storage, previous);
    return activity;
  }

  async removeActivityImage(actor: Actor, id: string): Promise<VenueActivityProps> {
    let previous: string | null = null;
    const activity = await this.unitOfWork.execute(async () => {
      const current = await this.requireActivity(id);
      previous = current.imageKey;
      const next: VenueActivityProps = {
        ...current,
        imageUrl: null,
        imageKey: null,
        updatedAt: this.clock.now(),
      };
      await this.repo.saveActivity(next);
      await this.record(actor, 'venue_activity.image_removed', 'VenueActivity', id);
      return next;
    });
    if (previous) await deleteImageQuietly(this.storage, previous);
    return activity;
  }

  async deleteActivity(actor: Actor, id: string): Promise<void> {
    const current = await this.requireActivity(id);
    await this.unitOfWork.execute(async () => {
      await this.repo.deleteActivity(id);
      await this.record(actor, 'venue_activity.deleted', 'VenueActivity', id);
    });
    if (current.imageKey) await deleteImageQuietly(this.storage, current.imageKey);
  }

  private async requireActivity(id: string): Promise<VenueActivityProps> {
    const a = await this.repo.findActivity(id);
    if (!a) throw new NotFoundError('Actividad', id);
    return a;
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

/* ---------- Cotizaciones ---------- */

@Injectable()
export class QuoteDesk {
  private readonly logger = new Logger(QuoteDesk.name);

  constructor(
    @Inject(QUOTE_REPOSITORY) private readonly quotes: QuoteRepository,
    @Inject(VENUE_REPOSITORY) private readonly venue: VenueRepository,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(VENUE_CONFIG) private readonly config: VenueConfig,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  /**
   * Guarda la solicitud y luego avisa a la tienda y confirma a quien la envió.
   * Si un correo falla solo se registra: la solicitud ya quedó en el panel.
   */
  async request(input: QuoteInput): Promise<QuoteRequestProps> {
    const now = this.clock.now();
    const valid = validateQuote(input, now);
    const found = valid.activityIds.length
      ? await this.venue.findActivities(valid.activityIds)
      : [];
    const names = chosenActivityNames(valid.activityIds, found, valid.kind);
    const quote = newQuoteRequest(valid, names, this.config.privacyPolicyVersion, now);
    await this.quotes.save(quote);

    const summary = quoteSummary(quote);
    const label = QUOTE_KIND_LABELS[quote.kind];
    for (const to of this.config.adminAlertEmails) {
      await this.sendQuietly(
        {
          to,
          subject: `Nueva solicitud de cotización: ${label} (${quote.name})`,
          text: `Llegó una solicitud de cotización desde «Visítanos».\n\n${summary}`,
        },
        'No se pudo avisar de la solicitud de cotización',
      );
    }
    const settings = (await this.venue.getSettings()) ?? EMPTY_VENUE_SETTINGS;
    await this.sendQuietly(
      {
        to: quote.email,
        subject: 'Recibimos tu solicitud de cotización',
        text: [
          `Hola, ${quote.name}.`,
          '',
          'Recibimos tu solicitud de cotización en Telar Casa Carrillo. La familia la revisará y te contactará por correo o teléfono.',
          ...(settings.quoteNote ? ['', settings.quoteNote] : []),
          '',
          'Esto fue lo que nos enviaste:',
          '',
          summary,
        ].join('\n'),
      },
      'No se pudo enviar la confirmación de la cotización',
    );
    return quote;
  }

  list(query: QuoteQuery) {
    return this.quotes.list(query);
  }

  async get(id: string): Promise<QuoteRequestProps> {
    const q = await this.quotes.find(id);
    if (!q) throw new NotFoundError('Cotización', id);
    return q;
  }

  async update(actor: Actor, id: string, changes: QuoteChanges): Promise<QuoteRequestProps> {
    const current = await this.get(id);
    const next = changeQuote(current, changes, this.clock.now());
    await this.quotes.save(next);
    await this.audit.record({
      actorId: actor.id,
      action: 'quote_request.updated',
      resource: 'QuoteRequest',
      resourceId: id,
      metadata: {
        fields: Object.keys(changes),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
      },
      ipAddress: actor.context.ipAddress,
    });
    return next;
  }

  private async sendQuietly(
    message: { to: string; subject: string; text: string },
    warning: string,
  ): Promise<void> {
    try {
      await this.email.send(message);
    } catch (error) {
      this.logger.warn({ err: error }, warning);
    }
  }
}
