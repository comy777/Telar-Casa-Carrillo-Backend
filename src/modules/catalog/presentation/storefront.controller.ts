import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/presentation/auth.decorators';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import { type CategoryTreeNode, Storefront } from '../application/storefront.service';
import { pesosToCents } from '../domain/money';
import { toCategory, toProductCard, toProductDetail } from './presenters';
import {
  CategoryPageResponse,
  CategoryTreeResponse,
  ProductCardPage,
  ProductDetailResponse,
  PublicArtisanPage,
  PublicArtisanResponse,
  SitemapResponse,
  StorefrontProductsQuery,
} from './storefront.dto';

/**
 * El catálogo cambia poco: los navegadores y una CDN pueden reutilizar las
 * respuestas un minuto y servir la versión anterior mientras se actualiza.
 */
const CACHE = 'public, max-age=60, stale-while-revalidate=300';

const toTree = (nodes: CategoryTreeNode[]): CategoryTreeResponse[] =>
  nodes.map((node) => ({ ...toCategory(node), children: toTree(node.children) }));

@ApiTags('catálogo')
@Public()
@Controller('catalog')
export class StorefrontController {
  constructor(private readonly storefront: Storefront) {}

  @Get('products')
  @Header('Cache-Control', CACHE)
  @ApiOperation({ summary: 'Busca y filtra productos publicados' })
  @ApiOkResponse({ type: ProductCardPage })
  async products(@Query() query: StorefrontProductsQuery): Promise<ProductCardPage> {
    const page = await this.storefront.searchProducts({
      page: query.page,
      pageSize: query.pageSize,
      search: query.q,
      categorySlug: query.category,
      artisanSlug: query.artisan,
      material: query.material,
      minPriceCents: query.minPrice === undefined ? undefined : pesosToCents(query.minPrice),
      maxPriceCents: query.maxPrice === undefined ? undefined : pesosToCents(query.maxPrice),
      featured: query.featured,
      inStock: query.inStock,
      sort: query.sort,
    });
    return { ...page, items: page.items.map(toProductCard) };
  }

  @Get('products/:slug')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: ProductDetailResponse })
  async product(@Param('slug') slug: string): Promise<ProductDetailResponse> {
    return toProductDetail(await this.storefront.getProduct(slug));
  }

  @Get('categories')
  @Header('Cache-Control', CACHE)
  @ApiOperation({ summary: 'Árbol de categorías visibles' })
  @ApiOkResponse({ type: [CategoryTreeResponse] })
  async categories(): Promise<CategoryTreeResponse[]> {
    return toTree(await this.storefront.categoryTree());
  }

  @Get('categories/:slug')
  @Header('Cache-Control', CACHE)
  @ApiOperation({ summary: 'Categoría con migas de pan y subcategorías' })
  @ApiOkResponse({ type: CategoryPageResponse })
  async category(@Param('slug') slug: string): Promise<CategoryPageResponse> {
    const page = await this.storefront.getCategory(slug);
    return {
      category: toCategory(page.category),
      breadcrumbs: page.breadcrumbs,
      children: page.children.map(toCategory),
    };
  }

  @Get('artisans')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: PublicArtisanPage })
  async artisans(@Query() query: PaginationQuery): Promise<PublicArtisanPage> {
    const page = await this.storefront.listArtisans(query);
    return { ...page, items: page.items.map(({ updatedAt: _u, ...artisan }) => artisan) };
  }

  @Get('artisans/:slug')
  @Header('Cache-Control', CACHE)
  @ApiOperation({ summary: 'Perfil del artesano (sus productos: /catalog/products?artisan=)' })
  @ApiOkResponse({ type: PublicArtisanResponse })
  async artisan(@Param('slug') slug: string): Promise<PublicArtisanResponse> {
    const { updatedAt: _u, ...artisan } = await this.storefront.getArtisan(slug);
    return artisan;
  }

  @Get('materials')
  @Header('Cache-Control', CACHE)
  @ApiOperation({ summary: 'Materiales de los productos publicados (para filtros)' })
  @ApiOkResponse({ type: [String] })
  materials(): Promise<string[]> {
    return this.storefront.listMaterials();
  }

  @Get('sitemap')
  @Header('Cache-Control', CACHE)
  @ApiOperation({ summary: 'Slugs publicados para generar sitemap.xml en el storefront' })
  @ApiOkResponse({ type: SitemapResponse })
  sitemap(): Promise<SitemapResponse> {
    return this.storefront.sitemap();
  }
}
