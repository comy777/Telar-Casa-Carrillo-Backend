import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import {
  MAX_QUOTE_ACTIVITIES,
  QUOTE_KINDS,
  QUOTE_STATUSES,
  type QuoteKind,
  type QuoteRequestProps,
  type QuoteStatus,
  type VenueActivityProps,
  type VenueSettings,
} from '../domain/venue';

/* ---------- Ajustes ---------- */

export class VenueSettingsDto {
  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: 6000,
    description: 'Markdown: ## títulos, párrafos, listas con -, **negrita** y [enlaces](/ruta)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  intro?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: 1000,
    description: 'Texto libre, una línea por franja de horario',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  schedule?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: 500,
    description: 'Enlace https al mapa',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mapUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: 300,
    description: 'Nota junto al formulario y en el correo de confirmación',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  quoteNote?: string | null;
}

export class VenueSettingsResponse {
  @ApiProperty({ nullable: true, type: String }) title!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Markdown' }) intro!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Texto libre, varias líneas' })
  schedule!: string | null;
  @ApiProperty({ nullable: true, type: String }) address!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'URL https' }) mapUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) quoteNote!: string | null;
}

export const toVenueSettingsResponse = (s: VenueSettings): VenueSettingsResponse => ({
  title: s.title,
  intro: s.intro,
  schedule: s.schedule,
  address: s.address,
  mapUrl: s.mapUrl,
  quoteNote: s.quoteNote,
});

export const venueSettingsFromDto = (dto: VenueSettingsDto): VenueSettings => ({
  title: dto.title ?? null,
  intro: dto.intro ?? null,
  schedule: dto.schedule ?? null,
  address: dto.address ?? null,
  mapUrl: dto.mapUrl ?? null,
  quoteNote: dto.quoteNote ?? null,
});

/* ---------- Actividades ---------- */

export class CreateVenueActivityDto {
  @ApiProperty({ example: 'Banquitas', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 600 })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateVenueActivityDto extends PartialType(CreateVenueActivityDto) {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: 200,
    description: 'Texto alternativo de la imagen',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  imageAlt?: string | null;
}

export class VenueActivityImageDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'JPEG, PNG o WebP, máx. 5 MB' })
  file!: unknown;
}

export class VenueActivityResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) imageUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) imageAlt!: string | null;
}

export class AdminVenueActivityResponse extends VenueActivityResponse {
  @ApiProperty() isPublished!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export const toVenueActivityResponse = (a: VenueActivityProps): VenueActivityResponse => ({
  id: a.id,
  name: a.name,
  description: a.description,
  imageUrl: a.imageUrl,
  imageAlt: a.imageAlt,
});

export const toAdminVenueActivityResponse = (
  a: VenueActivityProps,
): AdminVenueActivityResponse => ({
  ...toVenueActivityResponse(a),
  isPublished: a.isPublished,
  sortOrder: a.sortOrder,
  updatedAt: a.updatedAt,
});

export class VenuePageResponse {
  @ApiProperty({ type: VenueSettingsResponse }) settings!: VenueSettingsResponse;
  @ApiProperty({ type: [VenueActivityResponse], description: 'Solo las publicadas, en orden' })
  activities!: VenueActivityResponse[];
}

/* ---------- Cotizaciones ---------- */

export class CreateQuoteDto {
  @ApiProperty({ enum: QUOTE_KINDS, enumName: 'QuoteKind' })
  @IsIn(QUOTE_KINDS)
  kind!: QuoteKind;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'ana@correo.com', maxLength: 200 })
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ maxLength: 30 })
  @IsString()
  @MaxLength(30)
  phone!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date',
    example: '2026-12-20',
    description:
      'AAAA-MM-DD; no anterior a hoy (hora de Colombia). Obligatoria para EVENT y COURT_RENTAL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  eventDate?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '15:00',
    description: 'HH:MM (00:00 a 23:59). Obligatoria para COURT_RENTAL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  startTime?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    minimum: 1,
    maximum: 12,
    description: 'Horas. Obligatoria para COURT_RENTAL',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  durationHours?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    minimum: 1,
    maximum: 2000,
    description: 'Obligatoria para EVENT y GROUP_VISIT',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  people?: number | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: MAX_QUOTE_ACTIVITIES,
    description: 'Actividades publicadas que le interesan',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_QUOTE_ACTIVITIES)
  @IsUUID('all', { each: true })
  activityIds?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includesFood?: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string | null;

  @ApiProperty({
    description:
      'Debe ser true: aceptación del tratamiento de datos (Ley 1581). Si no, CONSENT_REQUIRED',
  })
  @IsBoolean()
  acceptPrivacy!: boolean;
}

export class QuoteQueryDto extends PaginationQuery {
  @ApiPropertyOptional({ enum: QUOTE_STATUSES, enumName: 'QuoteStatus' })
  @IsOptional()
  @IsIn(QUOTE_STATUSES)
  status?: QuoteStatus;

  @ApiPropertyOptional({ enum: QUOTE_KINDS, enumName: 'QuoteKind' })
  @IsOptional()
  @IsIn(QUOTE_KINDS)
  kind?: QuoteKind;
}

export class UpdateQuoteDto {
  @ApiPropertyOptional({ enum: QUOTE_STATUSES, enumName: 'QuoteStatus' })
  @IsOptional()
  @IsIn(QUOTE_STATUSES)
  status?: QuoteStatus;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNotes?: string | null;
}

export class QuoteRequestResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: QUOTE_KINDS, enumName: 'QuoteKind' }) kind!: QuoteKind;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty() phone!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date', example: '2026-12-20' })
  eventDate!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '15:00' }) startTime!: string | null;
  @ApiProperty({ nullable: true, type: Number }) durationHours!: number | null;
  @ApiProperty({ nullable: true, type: Number }) people!: number | null;
  @ApiProperty({ type: [String] }) activityNames!: string[];
  @ApiProperty() includesFood!: boolean;
  @ApiProperty({ nullable: true, type: String }) message!: string | null;
  @ApiProperty({ enum: QUOTE_STATUSES, enumName: 'QuoteStatus' }) status!: QuoteStatus;
  @ApiProperty({ nullable: true, type: String }) adminNotes!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class QuoteRequestPage {
  @ApiProperty({ type: [QuoteRequestResponse] }) items!: QuoteRequestResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export const toQuoteRequestResponse = (q: QuoteRequestProps): QuoteRequestResponse => ({
  id: q.id,
  kind: q.kind,
  name: q.name,
  email: q.email,
  phone: q.phone,
  eventDate: q.eventDate,
  startTime: q.startTime,
  durationHours: q.durationHours,
  people: q.people,
  activityNames: q.activityNames,
  includesFood: q.includesFood,
  message: q.message,
  status: q.status,
  adminNotes: q.adminNotes,
  createdAt: q.createdAt,
  updatedAt: q.updatedAt,
});
