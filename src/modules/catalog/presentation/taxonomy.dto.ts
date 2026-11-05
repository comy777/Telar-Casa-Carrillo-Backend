import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import { SLUG_MAX_LENGTH } from '../domain/slug';
import { TEXT_LIMITS } from '../domain/text';
import { ToBoolean } from './validators';

export class ImageUploadDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'JPEG, PNG o WebP, máx. 5 MB' })
  file!: unknown;
}

// ---------- Categorías ----------

export class CreateCategoryDto {
  @ApiProperty({ example: 'Mochilas' })
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name!: string;

  @ApiPropertyOptional({ example: 'mochilas' })
  @IsOptional()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  slug?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.categoryDescription)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid', description: 'null = raíz' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

export class AdminCategoryResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) parentId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) imageUrl!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
}

// ---------- Artesanos ----------

export class CreateArtisanDto {
  @ApiProperty({ example: 'Familia Epieyú' })
  @IsString()
  @MaxLength(TEXT_LIMITS.name)
  name!: string;

  @ApiPropertyOptional({ example: 'familia-epieyu' })
  @IsOptional()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  slug?: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Resumen corto' })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.biography)
  biography?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Historia completa' })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.story)
  story?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateArtisanDto extends PartialType(CreateArtisanDto) {}

export class ListAdminArtisansQuery extends PaginationQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class AdminArtisanResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: String }) biography!: string | null;
  @ApiProperty({ nullable: true, type: String }) story!: string | null;
  @ApiProperty({ nullable: true, type: String }) photoUrl!: string | null;
  @ApiProperty() isFeatured!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class AdminArtisanPage {
  @ApiProperty({ type: [AdminArtisanResponse] }) items!: AdminArtisanResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
