import type { ProductCard, ProductDetailView, PublicCategoryNode } from '../application/ports';
import type { Artisan } from '../domain/artisan';
import type { Category } from '../domain/category';
import { centsToPesos, pesosToCents } from '../domain/money';
import type { NewVariant, Product, ProductChanges, VariantChanges } from '../domain/product';
import type {
  AdminProductResponse,
  ProductFieldsDto,
  UpdateVariantDto,
  VariantDto,
} from './product.dto';
import type {
  CategoryResponse,
  ProductCardResponse,
  ProductDetailResponse,
} from './storefront.dto';
import type { AdminArtisanResponse, AdminCategoryResponse } from './taxonomy.dto';

const maybePesos = (cents: number | null): number | null =>
  cents === null ? null : centsToPesos(cents);

// ---------- Entrada ----------

export function toNewVariant(dto: VariantDto): NewVariant {
  return {
    name: dto.name,
    sku: dto.sku,
    attributes: dto.attributes,
    priceCents: pesosToCents(dto.price),
    compareAtPriceCents:
      dto.compareAtPrice === undefined || dto.compareAtPrice === null
        ? null
        : pesosToCents(dto.compareAtPrice),
    isActive: dto.isActive,
  };
}

export function toVariantChanges(input: UpdateVariantDto): VariantChanges {
  const dto = provided(input, ['compareAtPrice']);
  const changes: VariantChanges = {};
  if (dto.name !== undefined) changes.name = dto.name;
  if (dto.sku !== undefined) changes.sku = dto.sku;
  if (dto.attributes !== undefined) changes.attributes = dto.attributes;
  if (dto.price !== undefined) changes.priceCents = pesosToCents(dto.price);
  if (dto.compareAtPrice !== undefined) {
    changes.compareAtPriceCents =
      dto.compareAtPrice === null ? null : pesosToCents(dto.compareAtPrice);
  }
  if (dto.isActive !== undefined) changes.isActive = dto.isActive;
  return changes;
}

/**
 * Quita las claves no enviadas, para que "no enviado" no se confunda con "vaciar".
 * `@IsOptional()` también deja pasar null: solo se conserva en los campos que
 * admiten vaciarse (`nullable`); en los demás null equivale a no enviarlo.
 */
export function provided<T extends object>(
  value: T,
  nullable: readonly (keyof T)[] = [],
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) => item !== undefined && (item !== null || nullable.includes(key as keyof T)),
    ),
  ) as Partial<T>;
}

const PRODUCT_NULLABLE = ['shortDescription', 'artisanId', 'seoTitle', 'seoDescription'] as const;

export function toProductChanges(dto: Partial<ProductFieldsDto>): ProductChanges {
  const { taxRate, ...rest } = provided(dto, PRODUCT_NULLABLE);
  return {
    ...rest,
    ...(taxRate !== undefined && taxRate !== null
      ? { taxRateBasisPoints: Math.round(taxRate * 10_000) }
      : {}),
  };
}

// ---------- Administración ----------

export function toAdminProduct(product: Product): AdminProductResponse {
  const s = product.toSnapshot();
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    sku: s.sku,
    shortDescription: s.shortDescription,
    description: s.description,
    status: s.status,
    artisanId: s.artisanId,
    taxRate: s.taxRateBasisPoints / 10_000,
    isFeatured: s.isFeatured,
    seoTitle: s.seoTitle,
    seoDescription: s.seoDescription,
    categoryIds: s.categoryIds,
    materials: s.materials,
    techniques: s.techniques,
    variants: s.variants.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      attributes: v.attributes,
      price: centsToPesos(v.priceCents),
      compareAtPrice: maybePesos(v.compareAtPriceCents),
      currency: v.currency,
      isActive: v.isActive,
    })),
    images: s.images.map(({ storageKey: _storageKey, ...image }) => image),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toAdminCategory(category: Category): AdminCategoryResponse {
  const { imageKey: _imageKey, ...rest } = category.toSnapshot();
  return rest;
}

export function toAdminArtisan(artisan: Artisan): AdminArtisanResponse {
  const { photoKey: _photoKey, ...rest } = artisan.toSnapshot();
  return rest;
}

// ---------- Tienda ----------

export function toProductCard(card: ProductCard): ProductCardResponse {
  const { priceCents, compareAtPriceCents, ...rest } = card;
  return {
    ...rest,
    price: centsToPesos(priceCents),
    compareAtPrice: maybePesos(compareAtPriceCents),
  };
}

export function toProductDetail(view: ProductDetailView): ProductDetailResponse {
  const { taxRateBasisPoints, seoTitle, seoDescription, categories, variants, ...rest } = view;
  const primary = view.images.find((image) => image.isPrimary) ?? view.images[0];
  return {
    ...rest,
    taxRate: taxRateBasisPoints / 10_000,
    categories: categories.map(({ name, slug }) => ({ name, slug })),
    variants: variants.map(({ priceCents, compareAtPriceCents, ...variant }) => ({
      ...variant,
      price: centsToPesos(priceCents),
      compareAtPrice: maybePesos(compareAtPriceCents),
    })),
    // Valores listos para <title>, meta description y og:image.
    seo: {
      title: seoTitle ?? view.name,
      description: seoDescription ?? view.shortDescription,
      image: primary?.url ?? null,
    },
  };
}

export const toCategory = ({
  id,
  name,
  slug,
  description,
  imageUrl,
}: PublicCategoryNode): CategoryResponse => ({
  id,
  name,
  slug,
  description,
  imageUrl,
});
