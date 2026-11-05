import type { Page, PageRequest } from '../../../shared/application/audit-trail';
import type { Availability } from '../../../shared/domain/stock-availability';
import type { Artisan } from '../domain/artisan';
import type { Category } from '../domain/category';
import type { Product, ProductStatus } from '../domain/product';

// ---------- Escritura (administración) ----------

export interface AdminProductQuery extends PageRequest {
  /** Busca en nombre y SKU (del producto y de sus variantes). */
  search?: string | undefined;
  status?: ProductStatus | undefined;
  artisanId?: string | undefined;
  categoryId?: string | undefined;
}

export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  /**
   * Crea o actualiza el producto con sus variantes, imágenes, categorías y
   * materiales. Lanza ConflictError si el slug o algún SKU ya existen.
   */
  save(product: Product): Promise<void>;
  list(query: AdminProductQuery): Promise<Page<Product>>;
}
export const PRODUCT_REPOSITORY = Symbol('ProductRepository');

export interface CategoryRepository {
  findById(id: string): Promise<Category | null>;
  findAll(): Promise<Category[]>;
  /** Lanza ConflictError si el slug ya existe. */
  save(category: Category): Promise<void>;
  delete(id: string): Promise<void>;
  countProducts(id: string): Promise<number>;
  /** Devuelve solo los ids que existen. */
  findExistingIds(ids: string[]): Promise<string[]>;
}
export const CATEGORY_REPOSITORY = Symbol('CategoryRepository');

export interface ArtisanListQuery extends PageRequest {
  search?: string | undefined;
  isActive?: boolean | undefined;
}

export interface ArtisanRepository {
  findById(id: string): Promise<Artisan | null>;
  /** Lanza ConflictError si el slug ya existe. */
  save(artisan: Artisan): Promise<void>;
  list(query: ArtisanListQuery): Promise<Page<Artisan>>;
}
export const ARTISAN_REPOSITORY = Symbol('ArtisanRepository');

// ---------- Lectura (tienda) ----------

export type StorefrontSort = 'newest' | 'price_asc' | 'price_desc' | 'relevance';

export interface StorefrontProductQuery extends PageRequest {
  search?: string | undefined;
  /** Ya expandidas con sus subcategorías activas. */
  categoryIds?: string[] | undefined;
  artisanSlug?: string | undefined;
  material?: string | undefined;
  minPriceCents?: number | undefined;
  maxPriceCents?: number | undefined;
  featured?: boolean | undefined;
  /** Solo productos con alguna variante con unidades disponibles. */
  inStock?: boolean | undefined;
  sort: StorefrontSort;
}

export interface ImageView {
  url: string;
  altText: string | null;
}

export interface ArtisanSummary {
  name: string;
  slug: string;
}

/** Tarjeta de producto para listados. */
export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  isFeatured: boolean;
  artisan: ArtisanSummary | null;
  image: ImageView | null;
  /** Precio de la variante activa más barata ("desde"). */
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  hasMultipleVariants: boolean;
  /** La mejor disponibilidad entre sus variantes activas. */
  availability: Availability;
}

export interface ProductDetailView {
  id: string;
  slug: string;
  name: string;
  sku: string;
  shortDescription: string | null;
  description: string;
  taxRateBasisPoints: number;
  isFeatured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  artisan: (ArtisanSummary & { photoUrl: string | null; biography: string | null }) | null;
  categories: { id: string; name: string; slug: string }[];
  materials: string[];
  images: (ImageView & { id: string; variantId: string | null; isPrimary: boolean })[];
  variants: {
    id: string;
    name: string;
    sku: string;
    attributes: Record<string, string>;
    priceCents: number;
    compareAtPriceCents: number | null;
    currency: string;
    availability: Availability;
  }[];
  updatedAt: Date;
}

export interface PublicCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
}

export interface PublicArtisanView {
  id: string;
  name: string;
  slug: string;
  biography: string | null;
  story: string | null;
  photoUrl: string | null;
  isFeatured: boolean;
  publishedProducts: number;
  updatedAt: Date;
}

export interface SitemapEntry {
  slug: string;
  updatedAt: Date | null;
}

/**
 * Consultas de la tienda. Solo devuelven contenido visible: productos ACTIVE con
 * al menos una variante activa, categorías y artesanos activos.
 */
export interface CatalogReader {
  listProducts(query: StorefrontProductQuery): Promise<Page<ProductCard>>;
  findProductBySlug(slug: string): Promise<ProductDetailView | null>;
  /** Categorías activas (sin filtrar por ancestros inactivos; lo hace el caso de uso). */
  listActiveCategories(): Promise<PublicCategoryNode[]>;
  listArtisans(page: PageRequest): Promise<Page<PublicArtisanView>>;
  findArtisanBySlug(slug: string): Promise<PublicArtisanView | null>;
  /** Materiales usados por algún producto publicado. */
  listMaterials(): Promise<string[]>;
  sitemap(): Promise<{ products: SitemapEntry[]; artisans: SitemapEntry[] }>;
}
export const CATALOG_READER = Symbol('CatalogReader');
