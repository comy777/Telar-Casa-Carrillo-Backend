import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import type { Availability } from '../../../shared/domain/stock-availability';
import type { StorefrontSort } from '../application/ports';
import { SLUG_MAX_LENGTH } from '../domain/slug';
import { TEXT_LIMITS } from '../domain/text';
import { VariantResponse } from './product.dto';
import { ToBoolean } from './validators';

const SORTS: StorefrontSort[] = ['newest', 'price_asc', 'price_desc', 'relevance', 'best_selling'];
const AVAILABILITIES: Availability[] = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'];

export class StorefrontProductsQuery extends PaginationQuery {
  @ApiPropertyOptional({
    description: 'Texto libre: "mochila lana", "-algodón", "\\"hamaca grande\\""',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Incluye sus subcategorías' })
  @IsOptional()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  artisan?: string;

  @ApiPropertyOptional({ example: 'Algodón' })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.materialName)
  material?: string;

  @ApiPropertyOptional({ example: 'Telar de pedal' })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.materialName)
  technique?: string;

  @ApiPropertyOptional({ description: 'Pesos' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Pesos' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999)
  maxPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ description: 'Solo productos con unidades disponibles' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({
    enum: SORTS,
    description: 'Por defecto: relevance si hay q, si no newest',
  })
  @IsOptional()
  @IsIn(SORTS)
  sort?: StorefrontSort;
}

// ---------- Respuestas ----------

export class ImageResponse {
  @ApiProperty() url!: string;
  @ApiProperty({ nullable: true, type: String }) altText!: string | null;
}

export class ArtisanSummaryResponse {
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class ProductCardResponse {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) shortDescription!: string | null;
  @ApiProperty() isFeatured!: boolean;
  @ApiProperty({ nullable: true, type: ArtisanSummaryResponse })
  artisan!: ArtisanSummaryResponse | null;
  @ApiProperty({ nullable: true, type: ImageResponse }) image!: ImageResponse | null;
  @ApiProperty({ description: 'Precio de la variante más barata, en pesos' }) price!: number;
  @ApiProperty({ nullable: true, type: Number }) compareAtPrice!: number | null;
  @ApiProperty({ example: 'COP' }) currency!: string;
  @ApiProperty({ description: 'true si hay que elegir variante' }) hasMultipleVariants!: boolean;
  @ApiProperty({ enum: AVAILABILITIES, description: 'La mejor entre sus variantes' })
  availability!: Availability;
}

export class ProductCardPage {
  @ApiProperty({ type: [ProductCardResponse] }) items!: ProductCardResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class ProductImageResponse extends ImageResponse {
  @ApiProperty() id!: string;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty({ nullable: true, type: String }) variantId!: string | null;
}

export class ProductArtisanResponse extends ArtisanSummaryResponse {
  @ApiProperty({ nullable: true, type: String }) photoUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) biography!: string | null;
}

export class SeoResponse {
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) image!: string | null;
}

export class CategoryLinkResponse {
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class StorefrontVariantResponse extends VariantResponse {
  @ApiProperty({ enum: AVAILABILITIES, description: 'LOW_STOCK = últimas unidades' })
  availability!: Availability;
}

export class ProductDetailResponse {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ nullable: true, type: String }) shortDescription!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ example: 0.19, description: 'Tarifa de IVA incluida en el precio' })
  taxRate!: number;
  @ApiProperty() isFeatured!: boolean;
  @ApiProperty({ nullable: true, type: ProductArtisanResponse })
  artisan!: ProductArtisanResponse | null;
  @ApiProperty({ type: [CategoryLinkResponse] }) categories!: CategoryLinkResponse[];
  @ApiProperty({ type: [String] }) materials!: string[];
  @ApiProperty({ type: [String] }) techniques!: string[];
  @ApiProperty({ type: [ProductImageResponse] }) images!: ProductImageResponse[];
  @ApiProperty({ type: [StorefrontVariantResponse] }) variants!: StorefrontVariantResponse[];
  @ApiProperty({ type: SeoResponse }) seo!: SeoResponse;
  @ApiProperty() updatedAt!: Date;
}

export class CategoryResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) imageUrl!: string | null;
}

export class CategoryTreeResponse extends CategoryResponse {
  @ApiProperty({ type: () => [CategoryTreeResponse] }) children!: CategoryTreeResponse[];
}

export class CategoryPageResponse {
  @ApiProperty({ type: CategoryResponse }) category!: CategoryResponse;
  @ApiProperty({ type: [CategoryLinkResponse], description: 'De la raíz al padre' })
  breadcrumbs!: CategoryLinkResponse[];
  @ApiProperty({ type: [CategoryResponse] }) children!: CategoryResponse[];
}

export class PublicArtisanResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: String }) biography!: string | null;
  @ApiProperty({ nullable: true, type: String }) story!: string | null;
  @ApiProperty({ nullable: true, type: String }) photoUrl!: string | null;
  @ApiProperty() isFeatured!: boolean;
  @ApiProperty() publishedProducts!: number;
  @ApiProperty({ type: [String], description: 'Técnicas de sus productos publicados' })
  techniques!: string[];
}

export class PublicArtisanPage {
  @ApiProperty({ type: [PublicArtisanResponse] }) items!: PublicArtisanResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class SitemapEntryResponse {
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: Date }) updatedAt!: Date | null;
}

export class SitemapResponse {
  @ApiProperty({ type: [SitemapEntryResponse] }) products!: SitemapEntryResponse[];
  @ApiProperty({ type: [SitemapEntryResponse] }) categories!: SitemapEntryResponse[];
  @ApiProperty({ type: [SitemapEntryResponse] }) artisans!: SitemapEntryResponse[];
}
