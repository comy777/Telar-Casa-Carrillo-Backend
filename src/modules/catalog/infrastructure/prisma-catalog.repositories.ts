import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Page } from '../../../shared/application/audit-trail';
import { ConflictError } from '../../../shared/domain/errors';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import { uniqueViolationFields } from '../../../shared/infrastructure/prisma/prisma-errors';
import type {
  AdminProductQuery,
  ArtisanListQuery,
  ArtisanRepository,
  CategoryRepository,
  ProductRepository,
} from '../application/ports';
import { Artisan } from '../domain/artisan';
import { Category } from '../domain/category';
import { Product } from '../domain/product';
import {
  basisPointsToDecimal,
  centsToDecimal,
  decimalToBasisPoints,
  decimalToCents,
  toAttributes,
} from './prisma-catalog.mappers';

/** Traduce las violaciones de unicidad a errores con código estable. */
async function mapConflicts<T>(resource: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const fields = uniqueViolationFields(error);
    if (fields?.includes('slug')) {
      throw new ConflictError(`Ya existe ${resource} con ese slug`, 'SLUG_TAKEN');
    }
    if (fields?.includes('sku')) {
      throw new ConflictError('Ya existe un producto o variante con ese SKU', 'SKU_TAKEN');
    }
    throw error;
  }
}

const containsInsensitive = (value: string) => ({
  contains: value,
  mode: 'insensitive' as const,
});

// ---------- Productos ----------

const productInclude = {
  categories: { select: { categoryId: true } },
  materials: { select: { material: { select: { name: true } } } },
  variants: { orderBy: [{ price: 'asc' }, { name: 'asc' }] },
  images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function productToDomain(row: ProductRow): Product {
  return Product.restore({
    id: row.id,
    artisanId: row.artisanId,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    shortDescription: row.shortDescription,
    description: row.description,
    status: row.status,
    taxRateBasisPoints: decimalToBasisPoints(row.taxRate),
    isFeatured: row.isFeatured,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    categoryIds: row.categories.map((c) => c.categoryId),
    materials: row.materials.map((m) => m.material.name).sort((a, b) => a.localeCompare(b, 'es')),
    variants: row.variants.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      attributes: toAttributes(v.attributes),
      priceCents: decimalToCents(v.price),
      compareAtPriceCents: v.compareAtPrice ? decimalToCents(v.compareAtPrice) : null,
      currency: 'COP',
      isActive: v.isActive,
    })),
    images: row.images.map((i) => ({
      id: i.id,
      url: i.url,
      storageKey: i.publicId,
      altText: i.altText,
      sortOrder: i.sortOrder,
      isPrimary: i.isPrimary,
      variantId: i.variantId,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

@Injectable()
export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async findById(id: string): Promise<Product | null> {
    const row = await this.db.client.product.findUnique({ where: { id }, include: productInclude });
    return row ? productToDomain(row) : null;
  }

  /** Debe llamarse dentro de UnitOfWork: son varias escrituras. */
  save(product: Product): Promise<void> {
    const s = product.toSnapshot();
    const client = this.db.client;
    return mapConflicts('un producto', async () => {
      const materialIds: string[] = [];
      for (const name of s.materials) {
        const material = await client.material.upsert({
          where: { name },
          create: { name },
          update: {},
          select: { id: true },
        });
        materialIds.push(material.id);
      }

      const fields = {
        name: s.name,
        slug: s.slug,
        sku: s.sku,
        shortDescription: s.shortDescription,
        description: s.description,
        status: s.status,
        taxRate: basisPointsToDecimal(s.taxRateBasisPoints),
        isFeatured: s.isFeatured,
        seoTitle: s.seoTitle,
        seoDescription: s.seoDescription,
        artisan: s.artisanId ? { connect: { id: s.artisanId } } : { disconnect: true },
      };
      const categoryLinks = s.categoryIds.map((categoryId) => ({ categoryId }));
      const materialLinks = materialIds.map((materialId) => ({ materialId }));
      await client.product.upsert({
        where: { id: s.id },
        create: {
          ...fields,
          id: s.id,
          createdAt: s.createdAt,
          artisan: s.artisanId ? { connect: { id: s.artisanId } } : undefined,
          categories: { create: categoryLinks },
          materials: { create: materialLinks },
        },
        update: {
          ...fields,
          categories: { deleteMany: {}, create: categoryLinks },
          materials: { deleteMany: {}, create: materialLinks },
        },
      });

      for (const v of s.variants) {
        const variant = {
          name: v.name,
          sku: v.sku,
          attributes: v.attributes,
          price: centsToDecimal(v.priceCents),
          compareAtPrice:
            v.compareAtPriceCents === null ? null : centsToDecimal(v.compareAtPriceCents),
          currency: v.currency,
          isActive: v.isActive,
        };
        await client.productVariant.upsert({
          where: { id: v.id },
          create: { id: v.id, productId: s.id, ...variant },
          update: variant,
        });
      }

      await client.productImage.deleteMany({
        where: { productId: s.id, id: { notIn: s.images.map((i) => i.id) } },
      });
      // Primero las no principales: el índice parcial exige una sola principal
      // en todo momento, así que la anterior se desmarca antes de marcar la nueva.
      const images = [...s.images].sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary));
      for (const i of images) {
        const image = {
          url: i.url,
          publicId: i.storageKey,
          altText: i.altText,
          sortOrder: i.sortOrder,
          isPrimary: i.isPrimary,
          variantId: i.variantId,
        };
        await client.productImage.upsert({
          where: { id: i.id },
          create: { id: i.id, productId: s.id, ...image },
          update: image,
        });
      }
    });
  }

  async list(query: AdminProductQuery): Promise<Page<Product>> {
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.artisanId ? { artisanId: query.artisanId } : {}),
      ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
      ...(search
        ? {
            OR: [
              { name: containsInsensitive(search) },
              { sku: containsInsensitive(search) },
              { variants: { some: { sku: containsInsensitive(search) } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.client.product.count({ where }),
    ]);
    return { items: rows.map(productToDomain), total, page: query.page, pageSize: query.pageSize };
  }
}

// ---------- Categorías ----------

type CategoryRow = Prisma.CategoryGetPayload<object>;

const categoryToDomain = (row: CategoryRow): Category =>
  Category.restore({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imageUrl: row.imageUrl,
    imageKey: row.imageKey,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  });

@Injectable()
export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async findById(id: string): Promise<Category | null> {
    const row = await this.db.client.category.findUnique({ where: { id } });
    return row ? categoryToDomain(row) : null;
  }

  async findAll(): Promise<Category[]> {
    const rows = await this.db.client.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(categoryToDomain);
  }

  save(category: Category): Promise<void> {
    const { id, ...fields } = category.toSnapshot();
    return mapConflicts('una categoría', async () => {
      await this.db.client.category.upsert({
        where: { id },
        create: { id, ...fields },
        update: fields,
      });
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.client.category.delete({ where: { id } });
  }

  countProducts(id: string): Promise<number> {
    return this.db.client.productCategory.count({ where: { categoryId: id } });
  }

  async findExistingIds(ids: string[]): Promise<string[]> {
    const rows = await this.db.client.category.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}

// ---------- Artesanos ----------

type ArtisanRow = Prisma.ArtisanGetPayload<object>;

const artisanToDomain = (row: ArtisanRow): Artisan =>
  Artisan.restore({
    id: row.id,
    name: row.name,
    slug: row.slug,
    biography: row.biography,
    story: row.story,
    photoUrl: row.photoUrl,
    photoKey: row.photoKey,
    isFeatured: row.isFeatured,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

@Injectable()
export class PrismaArtisanRepository implements ArtisanRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async findById(id: string): Promise<Artisan | null> {
    const row = await this.db.client.artisan.findUnique({ where: { id } });
    return row ? artisanToDomain(row) : null;
  }

  save(artisan: Artisan): Promise<void> {
    // updatedAt lo asigna Prisma (@updatedAt).
    const { id, updatedAt: _updatedAt, ...fields } = artisan.toSnapshot();
    return mapConflicts('un artesano', async () => {
      await this.db.client.artisan.upsert({
        where: { id },
        create: { id, ...fields },
        update: fields,
      });
    });
  }

  async list(query: ArtisanListQuery): Promise<Page<Artisan>> {
    const search = query.search?.trim();
    const where: Prisma.ArtisanWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search ? { name: containsInsensitive(search) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.artisan.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.client.artisan.count({ where }),
    ]);
    return { items: rows.map(artisanToDomain), total, page: query.page, pageSize: query.pageSize };
  }
}
