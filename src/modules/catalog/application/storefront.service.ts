import { Inject, Injectable } from '@nestjs/common';
import type { Page, PageRequest } from '../../../shared/application/audit-trail';
import { NotFoundError } from '../../../shared/domain/errors';
import { ancestorsOf, descendantIdsOf } from '../domain/category-tree';
import {
  CATALOG_READER,
  type CatalogReader,
  type ProductCard,
  type ProductDetailView,
  type PublicArtisanView,
  type PublicCategoryNode,
  type SitemapEntry,
  type StorefrontProductQuery,
} from './ports';

export interface CategoryTreeNode extends PublicCategoryNode {
  children: CategoryTreeNode[];
}

export interface CategoryPage {
  category: PublicCategoryNode;
  /** De la raíz a la categoría padre. */
  breadcrumbs: Pick<PublicCategoryNode, 'name' | 'slug'>[];
  children: PublicCategoryNode[];
}

export type ProductSearch = Omit<StorefrontProductQuery, 'categoryIds' | 'sort'> & {
  categorySlug?: string | undefined;
  sort?: StorefrontProductQuery['sort'] | undefined;
};

const bySortOrder = (a: PublicCategoryNode, b: PublicCategoryNode) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es');

/**
 * Consultas públicas de la tienda. Solo exponen contenido publicado: una
 * categoría inactiva oculta también a sus subcategorías.
 */
@Injectable()
export class Storefront {
  constructor(@Inject(CATALOG_READER) private readonly reader: CatalogReader) {}

  async searchProducts(search: ProductSearch): Promise<Page<ProductCard>> {
    const { categorySlug, sort, ...rest } = search;
    let categoryIds: string[] | undefined;
    if (categorySlug) {
      const visible = await this.visibleCategories();
      const category = visible.find((c) => c.slug === categorySlug);
      if (!category) throw new NotFoundError('Categoría');
      categoryIds = descendantIdsOf(category.id, visible);
    }
    return this.reader.listProducts({
      ...rest,
      categoryIds,
      sort: sort ?? (rest.search ? 'relevance' : 'newest'),
    });
  }

  async getProduct(slug: string): Promise<ProductDetailView> {
    const product = await this.reader.findProductBySlug(slug);
    if (!product) throw new NotFoundError('Producto');
    const visibleIds = new Set((await this.visibleCategories()).map((c) => c.id));
    return { ...product, categories: product.categories.filter((c) => visibleIds.has(c.id)) };
  }

  async categoryTree(): Promise<CategoryTreeNode[]> {
    const visible = await this.visibleCategories();
    const build = (parentId: string | null): CategoryTreeNode[] =>
      visible
        .filter((c) => c.parentId === parentId)
        .sort(bySortOrder)
        .map((c) => ({ ...c, children: build(c.id) }));
    return build(null);
  }

  async getCategory(slug: string): Promise<CategoryPage> {
    const visible = await this.visibleCategories();
    const category = visible.find((c) => c.slug === slug);
    if (!category) throw new NotFoundError('Categoría');
    return {
      category,
      breadcrumbs: ancestorsOf(category.id, visible)
        .reverse()
        .map(({ name, slug: s }) => ({ name, slug: s })),
      children: visible.filter((c) => c.parentId === category.id).sort(bySortOrder),
    };
  }

  listArtisans(page: PageRequest): Promise<Page<PublicArtisanView>> {
    return this.reader.listArtisans(page);
  }

  async getArtisan(slug: string): Promise<PublicArtisanView> {
    const artisan = await this.reader.findArtisanBySlug(slug);
    if (!artisan) throw new NotFoundError('Artesano');
    return artisan;
  }

  listMaterials(): Promise<string[]> {
    return this.reader.listMaterials();
  }

  async sitemap(): Promise<{
    products: SitemapEntry[];
    categories: SitemapEntry[];
    artisans: SitemapEntry[];
  }> {
    const [entries, categories] = await Promise.all([
      this.reader.sitemap(),
      this.visibleCategories(),
    ]);
    return {
      ...entries,
      categories: categories.map((c) => ({ slug: c.slug, updatedAt: null })),
    };
  }

  /** Activas y con todos sus ancestros activos. */
  private async visibleCategories(): Promise<PublicCategoryNode[]> {
    const active = await this.reader.listActiveCategories();
    const activeIds = new Set(active.map((c) => c.id));
    return active.filter((c) => {
      // Si el padre no está en la lista de activas, la rama está oculta.
      let parentId = c.parentId;
      const seen = new Set<string>();
      while (parentId) {
        if (!activeIds.has(parentId) || seen.has(parentId)) return false;
        seen.add(parentId);
        parentId = active.find((p) => p.id === parentId)?.parentId ?? null;
      }
      return true;
    });
  }
}
