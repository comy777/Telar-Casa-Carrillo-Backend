import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type { QuoteQuery, QuoteRepository, VenueRepository } from '../application/venue.services';
import {
  EMPTY_VENUE_SETTINGS,
  type QuoteRequestProps,
  type VenueActivityProps,
  type VenueSettings,
} from '../domain/venue';

const SETTINGS_KEY = 'venue';

const ACTIVITY_ORDER: Prisma.VenueActivityOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { name: 'asc' },
];

@Injectable()
export class PrismaVenueRepository implements VenueRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async getSettings(): Promise<VenueSettings | null> {
    const row = await this.db.client.storeSetting.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row) return null;
    const stored = (row.value ?? {}) as Partial<VenueSettings>;
    return {
      title: stored.title ?? EMPTY_VENUE_SETTINGS.title,
      intro: stored.intro ?? EMPTY_VENUE_SETTINGS.intro,
      schedule: stored.schedule ?? EMPTY_VENUE_SETTINGS.schedule,
      address: stored.address ?? EMPTY_VENUE_SETTINGS.address,
      mapUrl: stored.mapUrl ?? EMPTY_VENUE_SETTINGS.mapUrl,
      quoteNote: stored.quoteNote ?? EMPTY_VENUE_SETTINGS.quoteNote,
    };
  }

  async saveSettings(s: VenueSettings): Promise<void> {
    const value = { ...s } as Prisma.InputJsonObject;
    await this.db.client.storeSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value },
      update: { value },
    });
  }

  listActivities(onlyPublished: boolean): Promise<VenueActivityProps[]> {
    return this.db.client.venueActivity.findMany({
      where: onlyPublished ? { isPublished: true } : {},
      orderBy: ACTIVITY_ORDER,
    });
  }

  findActivities(ids: string[]): Promise<VenueActivityProps[]> {
    return this.db.client.venueActivity.findMany({ where: { id: { in: ids } } });
  }

  findActivity(id: string): Promise<VenueActivityProps | null> {
    return this.db.client.venueActivity.findUnique({ where: { id } });
  }

  countActivities(): Promise<number> {
    return this.db.client.venueActivity.count();
  }

  async saveActivity({ id, createdAt, ...a }: VenueActivityProps): Promise<void> {
    await this.db.client.venueActivity.upsert({
      where: { id },
      create: { id, createdAt, ...a },
      update: a,
    });
  }

  async deleteActivity(id: string): Promise<void> {
    await this.db.client.venueActivity.deleteMany({ where: { id } });
  }
}

type QuoteRow = Prisma.QuoteRequestGetPayload<object>;

/** La columna es DATE: Prisma la entrega como medianoche UTC de ese día. */
const toDay = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null);
const fromDay = (day: string | null): Date | null => (day ? new Date(`${day}T00:00:00Z`) : null);

const toQuote = (row: QuoteRow): QuoteRequestProps => ({ ...row, eventDate: toDay(row.eventDate) });

@Injectable()
export class PrismaQuoteRepository implements QuoteRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async save({ id, eventDate, ...q }: QuoteRequestProps): Promise<void> {
    const data = { ...q, eventDate: fromDay(eventDate) };
    await this.db.client.quoteRequest.upsert({
      where: { id },
      create: { id, ...data },
      update: { status: q.status, adminNotes: q.adminNotes, updatedAt: q.updatedAt },
    });
  }

  async find(id: string): Promise<QuoteRequestProps | null> {
    const row = await this.db.client.quoteRequest.findUnique({ where: { id } });
    return row ? toQuote(row) : null;
  }

  async list(q: QuoteQuery) {
    const where: Prisma.QuoteRequestWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.quoteRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.client.quoteRequest.count({ where }),
    ]);
    return { items: rows.map(toQuote), total };
  }
}
