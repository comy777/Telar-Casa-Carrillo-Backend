import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Page, PageRequest } from '../../../shared/application/audit-trail';
import {
  type Availability,
  availabilityOf,
  availableQuantity,
  type StockLevel,
} from '../../../shared/domain/stock-availability';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type {
  CatalogReader,
  ProductCard,
  ProductDetailView,
  PublicArtisanView,
  PublicCategoryNode,
  SitemapEntry,
  StorefrontProductQuery,
  StorefrontSort,
} from '../application/ports';
import { centsToPesos } from '../domain/money';
import { decimalToBasisPoints, decimalToCents, toAttributes } from './prisma-catalog.mappers';

/** Producto visible en la tienda: publicado y con alguna variante activa. */
const PUBLISHED: Prisma.ProductWhereInput = {
  status: 'ACTIVE',
  variants: { some: { isActive: true } },
};

/**
 * Debe coincidir con la expresión del índice "product_search_idx"
 * (prisma/sql/constraints.sql) para que PostgreSQL lo use.
 */
const SEARCH_DOCUMENT = Prisma.sql`to_tsvector('spanish', coalesce(p."name", '') || ' ' || coalesce(p."description", ''))`;

const ORDER_BY: Record<StorefrontSort, Prisma.Sql> = {
  relevance: Prisma.sql`"rank" DESC, "createdAt" DESC, "id"`,
  newest: Prisma.sql`"createdAt" DESC, "id"`,
  price_asc: Prisma.sql`"minPrice" ASC, "createdAt" DESC, "id"`,
  price_desc: Prisma.sql`"minPrice" DESC, "createdAt" DESC, "id"`,
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
const pesos = (cents: number) => centsToPesos(cents).toFixed(2);

const STOCK = {
  quantityOnHand: true,
  quantityReserved: true,
  lowStockThreshold: true,
} satisfies Prisma.InventorySelect;

/** Sin fila de inventario la variante está agotada. */
const availabilityFor = (stock: StockLevel | null): Availability =>
  availabilityOf(availableQuantity(stock), stock?.lowStockThreshold ?? 0);

const AVAILABILITY_RANK: Record<Availability, number> = {
  IN_STOCK: 2,
  LOW_STOCK: 1,
  OUT_OF_STOCK: 0,
};

const bestAvailability = (values: Availability[]): Availability =>
  values.reduce<Availability>(
    (best, value) => (AVAILABILITY_RANK[value] > AVAILABILITY_RANK[best] ? value : best),
    'OUT_OF_STOCK',
  );

const cardSelect = {
  id: true,
  slug: true,
  name: true,
  shortDescription: true,
  isFeatured: true,
  artisan: { select: { name: true, slug: true, isActive: true } },
  images: {
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    take: 1,
    select: { url: true, altText: true },
  },
  variants: {
    where: { isActive: true },
    orderBy: { price: 'asc' },
    select: { price: true, compareAtPrice: true, currency: true, inventory: { select: STOCK } },
  },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

function toCard(row: CardRow): ProductCard {
  const cheapest = row.variants[0];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.shortDescription,
    isFeatured: row.isFeatured,
    artisan: row.artisan?.isActive ? { name: row.artisan.name, slug: row.artisan.slug } : null,
    image: row.images[0] ?? null,
    priceCents: cheapest ? decimalToCents(cheapest.price) : 0,
    compareAtPriceCents: cheapest?.compareAtPrice ? decimalToCents(cheapest.compareAtPrice) : null,
    currency: cheapest?.currency ?? 'COP',
    hasMultipleVariants: row.variants.length > 1,
    availability: bestAvailability(row.variants.map((v) => availabilityFor(v.inventory))),
  };
}

const artisanSelect = {
  id: true,
  name: true,
  slug: true,
  biography: true,
  story: true,
  photoUrl: true,
  isFeatured: true,
  updatedAt: true,
  _count: { select: { products: { where: PUBLISHED } } },
} satisfies Prisma.ArtisanSelect;

type ArtisanRow = Prisma.ArtisanGetPayload<{ select: typeof artisanSelect }>;

const toPublicArtisan = ({ _count, ...row }: ArtisanRow): PublicArtisanView => ({
  ...row,
  publishedProducts: _count.products,
});

@Injectable()
export class PrismaCatalogReader implements CatalogReader {
  constructor(private readonly db: PrismaClientProvider) {}

  async listProducts(query: StorefrontProductQuery): Promise<Page<ProductCard>> {
    const empty = { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    if (query.categoryIds?.length === 0) return empty;

    const matches = this.matchesQuery(query);
    const [countRows, idRows] = await Promise.all([
      this.db.client.$queryRaw<{ total: number }[]>`
        WITH matches AS (${matches}) SELECT COUNT(*)::int AS "total" FROM matches`,
      this.db.client.$queryRaw<{ id: string }[]>`
        WITH matches AS (${matches})
        SELECT "id" FROM matches
        ORDER BY ${ORDER_BY[query.sort]}
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ]);
    const total = countRows[0]?.total ?? 0;
    if (idRows.length === 0) return { ...empty, total };

    const ids = idRows.map((row) => row.id);
    const rows = await this.db.client.product.findMany({
      where: { id: { in: ids } },
      select: cardSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toCard(row)] : [];
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** Productos publicados que cumplen los filtros, con precio "desde" y relevancia. */
  private matchesQuery(query: StorefrontProductQuery): Prisma.Sql {
    const search = query.search?.trim();
    const tsQuery = search ? Prisma.sql`websearch_to_tsquery('spanish', ${search})` : null;

    const conditions: Prisma.Sql[] = [Prisma.sql`p."status" = 'ACTIVE'`];
    if (search && tsQuery) {
      // La búsqueda de texto entiende plurales; ILIKE cubre palabras parciales.
      conditions.push(
        Prisma.sql`(${SEARCH_DOCUMENT} @@ ${tsQuery} OR p."name" ILIKE ${`%${escapeLike(search)}%`})`,
      );
    }
    if (query.categoryIds) {
      const ids = Prisma.join(query.categoryIds.map((id) => Prisma.sql`${id}::uuid`));
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "ProductCategory" pc
        WHERE pc."productId" = p."id" AND pc."categoryId" IN (${ids}))`);
    }
    if (query.artisanSlug) {
      conditions.push(Prisma.sql`p."artisanId" IN (
        SELECT a."id" FROM "Artisan" a WHERE a."slug" = ${query.artisanSlug} AND a."isActive")`);
    }
    if (query.material) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "ProductMaterial" pm JOIN "Material" m ON m."id" = pm."materialId"
        WHERE pm."productId" = p."id" AND lower(m."name") = lower(${query.material}))`);
    }
    if (query.featured) conditions.push(Prisma.sql`p."isFeatured"`);
    if (query.inStock) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "ProductVariant" sv JOIN "Inventory" i ON i."variantId" = sv."id"
        WHERE sv."productId" = p."id" AND sv."isActive"
          AND i."quantityOnHand" - i."quantityReserved" > 0)`);
    }

    const having: Prisma.Sql[] = [];
    if (query.minPriceCents !== undefined) {
      having.push(Prisma.sql`MIN(v."price") >= ${pesos(query.minPriceCents)}::numeric`);
    }
    if (query.maxPriceCents !== undefined) {
      having.push(Prisma.sql`MIN(v."price") <= ${pesos(query.maxPriceCents)}::numeric`);
    }

    const rank = tsQuery ? Prisma.sql`ts_rank(${SEARCH_DOCUMENT}, ${tsQuery})` : Prisma.sql`0`;
    return Prisma.sql`
      SELECT p."id", p."createdAt", MIN(v."price") AS "minPrice", ${rank} AS "rank"
      FROM "Product" p
      JOIN "ProductVariant" v ON v."productId" = p."id" AND v."isActive"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY p."id"
      ${having.length > 0 ? Prisma.sql`HAVING ${Prisma.join(having, ' AND ')}` : Prisma.empty}`;
  }

  async findProductBySlug(slug: string): Promise<ProductDetailView | null> {
    const row = await this.db.client.product.findFirst({
      where: { ...PUBLISHED, slug },
      include: {
        artisan: true,
        categories: { include: { category: true } },
        materials: { include: { material: true } },
        images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        variants: {
          where: { isActive: true },
          orderBy: [{ price: 'asc' }, { name: 'asc' }],
          include: { inventory: { select: STOCK } },
        },
      },
    });
    if (!row) return null;
    const activeVariantIds = new Set(row.variants.map((v) => v.id));
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      sku: row.sku,
      shortDescription: row.shortDescription,
      description: row.description,
      taxRateBasisPoints: decimalToBasisPoints(row.taxRate),
      isFeatured: row.isFeatured,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      artisan: row.artisan?.isActive
        ? {
            name: row.artisan.name,
            slug: row.artisan.slug,
            photoUrl: row.artisan.photoUrl,
            biography: row.artisan.biography,
          }
        : null,
      categories: row.categories
        .filter(({ category }) => category.isActive)
        .map(({ category }) => ({ id: category.id, name: category.name, slug: category.slug })),
      materials: row.materials
        .map(({ material }) => material.name)
        .sort((a, b) => a.localeCompare(b, 'es')),
      images: row.images.map((image) => ({
        id: image.id,
        url: image.url,
        altText: image.altText,
        isPrimary: image.isPrimary,
        // Una imagen de una variante desactivada se muestra como imagen general.
        variantId:
          image.variantId && activeVariantIds.has(image.variantId) ? image.variantId : null,
      })),
      variants: row.variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        attributes: toAttributes(v.attributes),
        priceCents: decimalToCents(v.price),
        compareAtPriceCents: v.compareAtPrice ? decimalToCents(v.compareAtPrice) : null,
        currency: v.currency,
        availability: availabilityFor(v.inventory),
      })),
      updatedAt: row.updatedAt,
    };
  }

  async listActiveCategories(): Promise<PublicCategoryNode[]> {
    return this.db.client.category.findMany({
      where: { isActive: true },
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        description: true,
        imageUrl: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listArtisans(page: PageRequest): Promise<Page<PublicArtisanView>> {
    const where: Prisma.ArtisanWhereInput = { isActive: true };
    const [rows, total] = await Promise.all([
      this.db.client.artisan.findMany({
        where,
        select: artisanSelect,
        orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }, { id: 'asc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.db.client.artisan.count({ where }),
    ]);
    return { items: rows.map(toPublicArtisan), total, page: page.page, pageSize: page.pageSize };
  }

  async findArtisanBySlug(slug: string): Promise<PublicArtisanView | null> {
    const row = await this.db.client.artisan.findFirst({
      where: { slug, isActive: true },
      select: artisanSelect,
    });
    return row ? toPublicArtisan(row) : null;
  }

  async listMaterials(): Promise<string[]> {
    const rows = await this.db.client.material.findMany({
      where: { products: { some: { product: PUBLISHED } } },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => row.name);
  }

  async sitemap(): Promise<{ products: SitemapEntry[]; artisans: SitemapEntry[] }> {
    const [products, artisans] = await Promise.all([
      this.db.client.product.findMany({
        where: PUBLISHED,
        select: { slug: true, updatedAt: true },
        orderBy: { slug: 'asc' },
      }),
      this.db.client.artisan.findMany({
        where: { isActive: true },
        select: { slug: true, updatedAt: true },
        orderBy: { slug: 'asc' },
      }),
    ]);
    return { products, artisans };
  }
}
