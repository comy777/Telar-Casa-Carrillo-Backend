import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import { DEFAULT_TAX_RATE, requirePriceCents, requireTaxRate } from './money';
import { resolveSlug } from './slug';
import { normalizeSku, optionalText, requiredText, TEXT_LIMITS } from './text';

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export const PRODUCT_STATUSES: readonly ProductStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

/** Transiciones permitidas; publicar (→ ACTIVE) además exige variantes e imágenes. */
const TRANSITIONS: Record<ProductStatus, readonly ProductStatus[]> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

export const MAX_IMAGES_PER_PRODUCT = 20;
export const MAX_VARIANTS_PER_PRODUCT = 50;
export const MAX_ATTRIBUTES_PER_VARIANT = 10;
export const MAX_CATEGORIES_PER_PRODUCT = 10;
export const MAX_MATERIALS_PER_PRODUCT = 10;

export type VariantAttributes = Record<string, string>;

export interface VariantProps {
  id: string;
  name: string;
  sku: string;
  /** Opciones de la variante, p. ej. { color: "Natural", talla: "M" }. */
  attributes: VariantAttributes;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: 'COP';
  isActive: boolean;
}

export interface ProductImageProps {
  id: string;
  url: string;
  /** Clave en el almacenamiento, para borrar el archivo. */
  storageKey: string | null;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  variantId: string | null;
}

export interface ProductProps {
  id: string;
  artisanId: string | null;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string | null;
  description: string;
  status: ProductStatus;
  /** IVA en diezmilésimas (1900 = 19 %). */
  taxRateBasisPoints: number;
  isFeatured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  categoryIds: string[];
  materials: string[];
  variants: VariantProps[];
  images: ProductImageProps[];
  createdAt: Date;
  /** Lo asigna la base al guardar; el dominio no lo modifica. */
  updatedAt: Date;
}

export interface NewVariant {
  name: string;
  sku: string;
  attributes?: VariantAttributes | undefined;
  priceCents: number;
  compareAtPriceCents?: number | null | undefined;
  isActive?: boolean | undefined;
}

export type VariantChanges = Partial<NewVariant>;

export interface ProductDetails {
  name: string;
  slug?: string | null | undefined;
  sku: string;
  shortDescription?: string | null | undefined;
  description: string;
  artisanId?: string | null | undefined;
  taxRateBasisPoints?: number | undefined;
  isFeatured?: boolean | undefined;
  seoTitle?: string | null | undefined;
  seoDescription?: string | null | undefined;
  categoryIds?: string[] | undefined;
  materials?: string[] | undefined;
}

export type ProductChanges = Partial<ProductDetails>;

export interface NewImage {
  url: string;
  storageKey: string | null;
  altText?: string | null | undefined;
  variantId?: string | null | undefined;
}

export interface ImageChanges {
  altText?: string | null | undefined;
  sortOrder?: number | undefined;
  isPrimary?: boolean | undefined;
  variantId?: string | null | undefined;
}

// ---------- validaciones ----------

function limitList<T>(items: T[], max: number, code: string, label: string): T[] {
  if (items.length > max) {
    throw new BusinessRuleViolation(`Máximo ${max} ${label}`, code, { max });
  }
  return items;
}

/** "  lana   de oveja " → "Lana de oveja"; sin duplicados (sin importar mayúsculas). */
export function normalizeMaterials(names: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const raw of names) {
    const collapsed = requiredText(raw.replace(/\s+/g, ' '), 'material', TEXT_LIMITS.materialName);
    const name = collapsed.charAt(0).toLocaleUpperCase('es') + collapsed.slice(1).toLowerCase();
    byKey.set(name.toLowerCase(), name);
  }
  return limitList(
    [...byKey.values()],
    MAX_MATERIALS_PER_PRODUCT,
    'TOO_MANY_MATERIALS',
    'materiales',
  );
}

function normalizeAttributes(attributes: VariantAttributes | undefined): VariantAttributes {
  const entries = Object.entries(attributes ?? {});
  limitList(entries, MAX_ATTRIBUTES_PER_VARIANT, 'TOO_MANY_ATTRIBUTES', 'atributos por variante');
  const result: VariantAttributes = {};
  for (const [key, value] of entries) {
    result[requiredText(key, 'atributo', 40).toLowerCase()] = requiredText(value, key, 80);
  }
  return result;
}

function checkPrices(priceCents: number, compareAtPriceCents: number | null): void {
  requirePriceCents(priceCents, 'precio');
  if (compareAtPriceCents === null) return;
  requirePriceCents(compareAtPriceCents, 'precio anterior');
  if (compareAtPriceCents <= priceCents) {
    throw new BusinessRuleViolation(
      'El precio anterior debe ser mayor que el precio actual',
      'COMPARE_AT_PRICE_NOT_HIGHER',
    );
  }
}

function buildVariant(input: NewVariant): VariantProps {
  const compareAt = input.compareAtPriceCents ?? null;
  checkPrices(input.priceCents, compareAt);
  return {
    id: crypto.randomUUID(),
    name: requiredText(input.name, 'nombre de la variante', TEXT_LIMITS.variantName),
    sku: normalizeSku(input.sku),
    attributes: normalizeAttributes(input.attributes),
    priceCents: input.priceCents,
    compareAtPriceCents: compareAt,
    currency: 'COP',
    isActive: input.isActive ?? true,
  };
}

function uniqueIds(ids: string[]): string[] {
  return limitList(
    [...new Set(ids)],
    MAX_CATEGORIES_PER_PRODUCT,
    'TOO_MANY_CATEGORIES',
    'categorías por producto',
  );
}

/**
 * Producto del catálogo (agregado): datos comerciales, variantes e imágenes.
 *
 * Invariantes:
 * - Siempre tiene al menos una variante; las variantes no se borran (las
 *   referencian carritos y pedidos), se desactivan.
 * - Un producto publicado tiene al menos una variante activa y una imagen.
 * - Hay exactamente una imagen principal cuando hay imágenes.
 */
export class Product {
  private constructor(private props: ProductProps) {}

  static create(details: ProductDetails, variants: NewVariant[], now: Date): Product {
    if (variants.length === 0) {
      throw new BusinessRuleViolation(
        'El producto debe tener al menos una variante',
        'VARIANT_REQUIRED',
      );
    }
    const product = new Product({
      id: crypto.randomUUID(),
      artisanId: null,
      name: '',
      slug: '',
      sku: '',
      shortDescription: null,
      description: '',
      status: 'DRAFT',
      taxRateBasisPoints: DEFAULT_TAX_RATE,
      isFeatured: false,
      seoTitle: null,
      seoDescription: null,
      categoryIds: [],
      materials: [],
      variants: [],
      images: [],
      createdAt: now,
      updatedAt: now,
    });
    product.update(details);
    for (const variant of variants) product.addVariant(variant);
    return product;
  }

  /** Reconstrucción desde persistencia. */
  static restore(props: ProductProps): Product {
    return new Product({
      ...props,
      categoryIds: [...props.categoryIds],
      materials: [...props.materials],
      variants: props.variants.map((v) => ({ ...v, attributes: { ...v.attributes } })),
      images: props.images.map((image) => ({ ...image })),
    });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): ProductStatus {
    return this.props.status;
  }
  get artisanId(): string | null {
    return this.props.artisanId;
  }
  get categoryIds(): readonly string[] {
    return this.props.categoryIds;
  }
  get isPublished(): boolean {
    return this.props.status === 'ACTIVE';
  }

  /** Cambia los campos indicados; los no indicados se conservan. */
  update(changes: ProductChanges): void {
    const p = this.props;
    if (changes.name !== undefined) {
      p.name = requiredText(changes.name, 'nombre', TEXT_LIMITS.name);
    }
    // El slug se deriva del nombre solo al crear; después cambia solo si se pide.
    if (changes.slug !== undefined || !p.slug) {
      p.slug = resolveSlug(changes.slug, p.name);
    }
    if (changes.sku !== undefined) p.sku = normalizeSku(changes.sku);
    if (changes.description !== undefined) {
      p.description = requiredText(changes.description, 'descripción', TEXT_LIMITS.description);
    }
    if (changes.shortDescription !== undefined) {
      p.shortDescription = optionalText(
        changes.shortDescription,
        'descripción corta',
        TEXT_LIMITS.shortDescription,
      );
    }
    if (changes.artisanId !== undefined) p.artisanId = changes.artisanId;
    if (changes.taxRateBasisPoints !== undefined) {
      p.taxRateBasisPoints = requireTaxRate(changes.taxRateBasisPoints);
    }
    if (changes.isFeatured !== undefined) p.isFeatured = changes.isFeatured;
    if (changes.seoTitle !== undefined) {
      p.seoTitle = optionalText(changes.seoTitle, 'título SEO', TEXT_LIMITS.seoTitle);
    }
    if (changes.seoDescription !== undefined) {
      p.seoDescription = optionalText(
        changes.seoDescription,
        'descripción SEO',
        TEXT_LIMITS.seoDescription,
      );
    }
    if (changes.categoryIds !== undefined) p.categoryIds = uniqueIds(changes.categoryIds);
    if (changes.materials !== undefined) p.materials = normalizeMaterials(changes.materials);
  }

  changeStatus(to: ProductStatus): void {
    const from = this.props.status;
    if (!TRANSITIONS[from].includes(to)) {
      throw new BusinessRuleViolation(
        `No se puede pasar de ${from} a ${to}`,
        'INVALID_STATUS_TRANSITION',
        { from, to, allowed: TRANSITIONS[from] },
      );
    }
    if (to === 'ACTIVE') this.assertPublishable();
    this.props.status = to;
  }

  private assertPublishable(): void {
    const missing: string[] = [];
    if (!this.props.variants.some((v) => v.isActive)) missing.push('variante activa');
    if (this.props.images.length === 0) missing.push('imagen');
    if (missing.length > 0) {
      throw new BusinessRuleViolation(
        `Para publicar falta: ${missing.join(', ')}`,
        'PRODUCT_NOT_PUBLISHABLE',
        { missing },
      );
    }
  }

  // ---------- variantes ----------

  addVariant(input: NewVariant): VariantProps {
    limitList(
      [...this.props.variants, input],
      MAX_VARIANTS_PER_PRODUCT,
      'TOO_MANY_VARIANTS',
      'variantes por producto',
    );
    const variant = buildVariant(input);
    this.assertSkuFree(variant.sku, null);
    this.props.variants.push(variant);
    return { ...variant };
  }

  updateVariant(variantId: string, changes: VariantChanges): VariantProps {
    const variant = this.findVariant(variantId);
    const next: VariantProps = { ...variant, attributes: { ...variant.attributes } };
    if (changes.name !== undefined) {
      next.name = requiredText(changes.name, 'nombre de la variante', TEXT_LIMITS.variantName);
    }
    if (changes.sku !== undefined) {
      next.sku = normalizeSku(changes.sku);
      this.assertSkuFree(next.sku, variant.id);
    }
    if (changes.attributes !== undefined) next.attributes = normalizeAttributes(changes.attributes);
    if (changes.priceCents !== undefined) next.priceCents = changes.priceCents;
    if (changes.compareAtPriceCents !== undefined) {
      next.compareAtPriceCents = changes.compareAtPriceCents;
    }
    if (changes.isActive !== undefined) next.isActive = changes.isActive;
    checkPrices(next.priceCents, next.compareAtPriceCents);

    const othersActive = this.props.variants.some((v) => v.id !== variant.id && v.isActive);
    if (this.isPublished && !next.isActive && !othersActive) {
      throw new BusinessRuleViolation(
        'Un producto publicado necesita al menos una variante activa',
        'LAST_ACTIVE_VARIANT',
      );
    }
    Object.assign(variant, next);
    return { ...variant };
  }

  private findVariant(variantId: string): VariantProps {
    const variant = this.props.variants.find((v) => v.id === variantId);
    if (!variant) throw new NotFoundError('Variante', variantId);
    return variant;
  }

  private assertSkuFree(sku: string, exceptVariantId: string | null): void {
    if (this.props.variants.some((v) => v.sku === sku && v.id !== exceptVariantId)) {
      throw new BusinessRuleViolation('Otra variante del producto ya usa ese SKU', 'SKU_TAKEN', {
        sku,
      });
    }
  }

  // ---------- imágenes ----------

  addImage(input: NewImage): ProductImageProps {
    if (this.props.images.length >= MAX_IMAGES_PER_PRODUCT) {
      throw new BusinessRuleViolation(
        `Máximo ${MAX_IMAGES_PER_PRODUCT} imágenes por producto`,
        'TOO_MANY_IMAGES',
        { max: MAX_IMAGES_PER_PRODUCT },
      );
    }
    if (input.variantId) this.findVariant(input.variantId);
    const image: ProductImageProps = {
      id: crypto.randomUUID(),
      url: input.url,
      storageKey: input.storageKey,
      altText: optionalText(input.altText, 'texto alternativo', TEXT_LIMITS.altText),
      sortOrder: Math.max(-1, ...this.props.images.map((i) => i.sortOrder)) + 1,
      isPrimary: this.props.images.length === 0,
      variantId: input.variantId ?? null,
    };
    this.props.images.push(image);
    return { ...image };
  }

  updateImage(imageId: string, changes: ImageChanges): ProductImageProps {
    const image = this.findImage(imageId);
    if (changes.altText !== undefined) {
      image.altText = optionalText(changes.altText, 'texto alternativo', TEXT_LIMITS.altText);
    }
    if (changes.sortOrder !== undefined) {
      if (!Number.isInteger(changes.sortOrder) || changes.sortOrder < 0) {
        throw new BusinessRuleViolation('El orden debe ser un entero positivo', 'INVALID_ORDER');
      }
      image.sortOrder = changes.sortOrder;
    }
    if (changes.variantId !== undefined) {
      if (changes.variantId) this.findVariant(changes.variantId);
      image.variantId = changes.variantId;
    }
    if (changes.isPrimary === true) {
      for (const other of this.props.images) other.isPrimary = other.id === image.id;
    } else if (changes.isPrimary === false && image.isPrimary) {
      throw new BusinessRuleViolation(
        'Marca otra imagen como principal en lugar de desmarcar esta',
        'PRIMARY_IMAGE_REQUIRED',
      );
    }
    return { ...image };
  }

  /** Quita la imagen y la devuelve para borrar el archivo después de guardar. */
  removeImage(imageId: string): ProductImageProps {
    const image = this.findImage(imageId);
    if (this.isPublished && this.props.images.length === 1) {
      throw new BusinessRuleViolation(
        'Un producto publicado necesita al menos una imagen',
        'LAST_IMAGE',
      );
    }
    this.props.images = this.props.images.filter((i) => i.id !== imageId);
    if (image.isPrimary) {
      const next = [...this.props.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];
      if (next) next.isPrimary = true;
    }
    return { ...image };
  }

  private findImage(imageId: string): ProductImageProps {
    const image = this.props.images.find((i) => i.id === imageId);
    if (!image) throw new NotFoundError('Imagen', imageId);
    return image;
  }

  toSnapshot(): Readonly<ProductProps> {
    return Product.restore(this.props).props;
  }
}
