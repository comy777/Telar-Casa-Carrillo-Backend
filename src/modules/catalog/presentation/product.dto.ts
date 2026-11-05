import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import {
  MAX_CATEGORIES_PER_PRODUCT,
  MAX_MATERIALS_PER_PRODUCT,
  MAX_VARIANTS_PER_PRODUCT,
  PRODUCT_STATUSES,
  type ProductStatus,
} from '../domain/product';
import { SLUG_MAX_LENGTH } from '../domain/slug';
import { TEXT_LIMITS } from '../domain/text';
import { IsStringRecord, ToBoolean } from './validators';

/** Pesos colombianos; se admiten hasta dos decimales. */
const MAX_PRICE_PESOS = 9_999_999_999;

// ---------- Variantes ----------

export class VariantDto {
  @ApiProperty({ example: 'Natural / Grande' })
  @IsString()
  @MaxLength(TEXT_LIMITS.variantName)
  name!: string;

  @ApiProperty({ example: 'MOCH-WAY-NAT-G', description: 'Se guarda en mayúsculas' })
  @IsString()
  @MaxLength(TEXT_LIMITS.sku)
  sku!: string;

  @ApiPropertyOptional({ example: { color: 'Natural', tamaño: 'Grande' } })
  @IsOptional()
  @IsStringRecord()
  attributes?: Record<string, string>;

  @ApiProperty({ example: 185000, description: 'Precio en pesos, IVA incluido' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE_PESOS)
  price!: number;

  @ApiPropertyOptional({
    example: 220000,
    nullable: true,
    type: Number,
    description: 'Precio anterior (tachado); debe ser mayor que price',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE_PESOS)
  compareAtPrice?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVariantDto extends PartialType(VariantDto) {}

// ---------- Productos ----------

export class ProductFieldsDto {
  @ApiProperty({ example: 'Mochila wayuu tradicional' })
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name!: string;

  @ApiPropertyOptional({
    example: 'mochila-wayuu-tradicional',
    description: 'Por defecto, del nombre',
  })
  @IsOptional()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  slug?: string;

  @ApiProperty({ example: 'MOCH-WAY', description: 'Referencia base del producto' })
  @IsString()
  @MaxLength(TEXT_LIMITS.sku)
  sku!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.shortDescription)
  shortDescription?: string | null;

  @ApiProperty()
  @IsString()
  @MaxLength(TEXT_LIMITS.description)
  description!: string;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  artisanId?: string | null;

  @ApiPropertyOptional({ example: 0.19, description: 'Tarifa de IVA (0 a 1)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  taxRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: TEXT_LIMITS.seoTitle })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.seoTitle)
  seoTitle?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: TEXT_LIMITS.seoDescription })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.seoDescription)
  seoDescription?: string | null;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PRODUCT)
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Algodón', 'Hilo de lana'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MATERIALS_PER_PRODUCT)
  @IsString({ each: true })
  @MaxLength(TEXT_LIMITS.materialName, { each: true })
  materials?: string[];
}

export class CreateProductDto extends ProductFieldsDto {
  @ApiProperty({ type: [VariantDto], description: 'Al menos una variante' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VARIANTS_PER_PRODUCT)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants!: VariantDto[];
}

export class UpdateProductDto extends PartialType(ProductFieldsDto) {}

export class ChangeProductStatusDto {
  @ApiProperty({ enum: PRODUCT_STATUSES })
  @IsIn(PRODUCT_STATUSES)
  status!: ProductStatus;
}

export class ListAdminProductsQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Busca en nombre y SKU' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  artisanId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

// ---------- Imágenes ----------

/** Campos de texto del formulario (el archivo llega aparte, en `file`). */
export class ProductImageFieldsDto {
  @ApiPropertyOptional({ description: 'Descripción para lectores de pantalla y SEO' })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.altText)
  altText?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Imagen de una variante específica' })
  @IsOptional()
  @IsUUID()
  variantId?: string;
}

/** Solo para la documentación OpenAPI: el formulario completo. */
export class UploadProductImageDto extends ProductImageFieldsDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'JPEG, PNG o WebP, máx. 5 MB' })
  file!: unknown;
}

export class UpdateProductImageDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.altText)
  altText?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'true la vuelve la imagen principal' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  variantId?: string | null;
}

// ---------- Respuestas ----------

export class VariantResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  attributes!: Record<string, string>;
  @ApiProperty({ description: 'Pesos, IVA incluido' }) price!: number;
  @ApiProperty({ nullable: true, type: Number }) compareAtPrice!: number | null;
  @ApiProperty({ example: 'COP' }) currency!: string;
}

export class AdminVariantResponse extends VariantResponse {
  @ApiProperty() isActive!: boolean;
}

export class AdminImageResponse {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ nullable: true, type: String }) altText!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty({ nullable: true, type: String }) variantId!: string | null;
}

export class AdminProductResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ nullable: true, type: String }) shortDescription!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: PRODUCT_STATUSES }) status!: ProductStatus;
  @ApiProperty({ nullable: true, type: String }) artisanId!: string | null;
  @ApiProperty({ example: 0.19 }) taxRate!: number;
  @ApiProperty() isFeatured!: boolean;
  @ApiProperty({ nullable: true, type: String }) seoTitle!: string | null;
  @ApiProperty({ nullable: true, type: String }) seoDescription!: string | null;
  @ApiProperty({ type: [String] }) categoryIds!: string[];
  @ApiProperty({ type: [String] }) materials!: string[];
  @ApiProperty({ type: [AdminVariantResponse] }) variants!: AdminVariantResponse[];
  @ApiProperty({ type: [AdminImageResponse] }) images!: AdminImageResponse[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class AdminProductPage {
  @ApiProperty({ type: [AdminProductResponse] }) items!: AdminProductResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
