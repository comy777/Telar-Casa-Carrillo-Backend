import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError } from '../../../shared/domain/errors';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type {
  ContactRepository,
  ContentRepository,
  NewsletterRepository,
  Subscriber,
} from '../application/content.services';
import {
  type BannerProps,
  type ContactMessageProps,
  type ContactStatus,
  EMPTY_SETTINGS,
  type FaqProps,
  type PageProps,
  type StoreSettings,
  type TestimonialProps,
} from '../domain/content';

const SETTINGS_KEY = 'store';

type PageRow = Prisma.PageGetPayload<object>;

const toPage = (row: PageRow): PageProps => {
  const content = (row.content ?? {}) as { body?: unknown };
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: typeof content.body === 'string' ? content.body : '',
    isPublished: row.isPublished,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
};

@Injectable()
export class PrismaContentRepository implements ContentRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async listBanners(): Promise<BannerProps[]> {
    const rows = await this.db.client.banner.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(({ createdAt: _c, updatedAt: _u, ...b }) => b);
  }

  async findBanner(id: string): Promise<BannerProps | null> {
    const row = await this.db.client.banner.findUnique({ where: { id } });
    if (!row) return null;
    const { createdAt: _c, updatedAt: _u, ...b } = row;
    return b;
  }

  async saveBanner({ id, ...b }: BannerProps): Promise<void> {
    await this.db.client.banner.upsert({ where: { id }, create: { id, ...b }, update: b });
  }

  async deleteBanner(id: string): Promise<void> {
    await this.db.client.banner.deleteMany({ where: { id } });
  }

  listTestimonials(onlyPublished: boolean): Promise<TestimonialProps[]> {
    return this.db.client.testimonial.findMany({
      where: onlyPublished ? { isPublished: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  findTestimonial(id: string): Promise<TestimonialProps | null> {
    return this.db.client.testimonial.findUnique({ where: { id } });
  }

  async saveTestimonial({ id, ...t }: TestimonialProps): Promise<void> {
    await this.db.client.testimonial.upsert({ where: { id }, create: { id, ...t }, update: t });
  }

  async deleteTestimonial(id: string): Promise<void> {
    await this.db.client.testimonial.deleteMany({ where: { id } });
  }

  listFaqs(onlyPublished: boolean): Promise<FaqProps[]> {
    return this.db.client.faq.findMany({
      where: onlyPublished ? { isPublished: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { question: 'asc' }],
    });
  }

  findFaq(id: string): Promise<FaqProps | null> {
    return this.db.client.faq.findUnique({ where: { id } });
  }

  async saveFaq({ id, ...f }: FaqProps): Promise<void> {
    await this.db.client.faq.upsert({ where: { id }, create: { id, ...f }, update: f });
  }

  async deleteFaq(id: string): Promise<void> {
    await this.db.client.faq.deleteMany({ where: { id } });
  }

  async listPages(): Promise<PageProps[]> {
    return (await this.db.client.page.findMany({ orderBy: { title: 'asc' } })).map(toPage);
  }

  async findPage(id: string): Promise<PageProps | null> {
    const row = await this.db.client.page.findUnique({ where: { id } });
    return row ? toPage(row) : null;
  }

  async findPageBySlug(slug: string): Promise<PageProps | null> {
    const row = await this.db.client.page.findUnique({ where: { slug } });
    return row ? toPage(row) : null;
  }

  async savePage(p: PageProps): Promise<void> {
    const data = {
      slug: p.slug,
      title: p.title,
      content: { format: 'markdown', body: p.body },
      isPublished: p.isPublished,
      publishedAt: p.publishedAt,
    };
    try {
      await this.db.client.page.upsert({
        where: { id: p.id },
        create: { id: p.id, ...data },
        update: data,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Ya existe una página con ese slug', 'SLUG_TAKEN');
      }
      throw error;
    }
  }

  async deletePage(id: string): Promise<void> {
    await this.db.client.page.deleteMany({ where: { id } });
  }

  async getSettings(): Promise<StoreSettings | null> {
    const row = await this.db.client.storeSetting.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row) return null;
    return { ...EMPTY_SETTINGS, ...(row.value as Partial<StoreSettings>) };
  }

  async saveSettings(s: StoreSettings): Promise<void> {
    const value = s as unknown as Prisma.InputJsonValue;
    await this.db.client.storeSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value },
      update: { value },
    });
  }
}

@Injectable()
export class PrismaNewsletterRepository implements NewsletterRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  findByEmail(email: string): Promise<Subscriber | null> {
    return this.db.client.newsletterSubscriber.findUnique({ where: { email } });
  }

  findByTokenHash(tokenHash: string): Promise<Subscriber | null> {
    return this.db.client.newsletterSubscriber.findUnique({ where: { tokenHash } });
  }

  async save({ id, ...s }: Subscriber): Promise<void> {
    await this.db.client.newsletterSubscriber.upsert({
      where: { id },
      create: { id, ...s },
      update: s,
    });
  }

  async list(q: { page: number; pageSize: number; onlyActive: boolean }) {
    const where: Prisma.NewsletterSubscriberWhereInput = q.onlyActive
      ? { confirmedAt: { not: null }, unsubscribedAt: null }
      : {};
    const [items, total] = await Promise.all([
      this.db.client.newsletterSubscriber.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.client.newsletterSubscriber.count({ where }),
    ]);
    return { items, total };
  }
}

@Injectable()
export class PrismaContactRepository implements ContactRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async save({ id, ...m }: ContactMessageProps): Promise<void> {
    await this.db.client.contactMessage.upsert({
      where: { id },
      create: { id, ...m },
      update: { status: m.status },
    });
  }

  find(id: string): Promise<ContactMessageProps | null> {
    return this.db.client.contactMessage.findUnique({ where: { id } });
  }

  async list(q: { status?: ContactStatus; page: number; pageSize: number }) {
    const where = q.status ? { status: q.status } : {};
    const [items, total] = await Promise.all([
      this.db.client.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.client.contactMessage.count({ where }),
    ]);
    return { items, total };
  }

  countNew(): Promise<number> {
    return this.db.client.contactMessage.count({ where: { status: 'NEW' } });
  }
}
