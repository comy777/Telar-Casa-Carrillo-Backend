import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsBoolean,
  IsDate,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import type {
  BannerProps,
  ContactMessageProps,
  FaqProps,
  PageProps,
  StoreSettings,
  TestimonialProps,
} from '../domain/content';
import type { Subscriber } from '../application/content.services';

/** multipart envía todo como texto: "true"/"false" → boolean. */
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;
const toNullableDate = ({ value }: { value: unknown }) =>
  value === '' || value === null
    ? null
    : value === undefined
      ? undefined
      : new Date(value as string);

/* ---------- Banners ---------- */

export class BannerDto {
  @ApiProperty({ example: 'Ruanas nuevas del telar' })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Texto alternativo de la imagen',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  imageAlt?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '/categorias/ruanas' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Ver ruanas' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ctaLabel?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @Transform(toNullableDate)
  @IsDate()
  startsAt?: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  @IsOptional()
  @Transform(toNullableDate)
  @IsDate()
  endsAt?: Date | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class CreateBannerDto extends BannerDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'JPEG, PNG o WebP, máx. 5 MB' })
  file!: unknown;
}

export class UpdateBannerDto extends PartialType(BannerDto) {}

export class BannerResponse {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true, type: String }) subtitle!: string | null;
  @ApiProperty() imageUrl!: string;
  @ApiProperty({ nullable: true, type: String }) imageAlt!: string | null;
  @ApiProperty({ nullable: true, type: String }) targetUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) ctaLabel!: string | null;
}

export class AdminBannerResponse extends BannerResponse {
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) startsAt!: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) endsAt!: Date | null;
  @ApiProperty() sortOrder!: number;
}

export const toBannerResponse = (b: BannerProps): BannerResponse => ({
  id: b.id,
  title: b.title,
  subtitle: b.subtitle,
  imageUrl: b.imageUrl,
  imageAlt: b.imageAlt,
  targetUrl: b.targetUrl,
  ctaLabel: b.ctaLabel,
});

export const toAdminBannerResponse = (b: BannerProps): AdminBannerResponse => ({
  ...toBannerResponse(b),
  isActive: b.isActive,
  startsAt: b.startsAt,
  endsAt: b.endsAt,
  sortOrder: b.sortOrder,
});

/* ---------- Testimonios ---------- */

export class TestimonialDto {
  @ApiProperty({ example: 'Marta R.' })
  @IsString()
  @MaxLength(80)
  customerName!: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Tunja' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  location?: string | null;

  @ApiProperty()
  @IsString()
  @MaxLength(800)
  content!: string;

  @ApiPropertyOptional({ nullable: true, type: Number, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateTestimonialDto extends PartialType(TestimonialDto) {}

export class TestimonialResponse {
  @ApiProperty() id!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty({ nullable: true, type: String }) location!: string | null;
  @ApiProperty() content!: string;
  @ApiProperty({ nullable: true, type: Number }) rating!: number | null;
}

export class AdminTestimonialResponse extends TestimonialResponse {
  @ApiProperty() isPublished!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export const toTestimonialResponse = (t: TestimonialProps): TestimonialResponse => ({
  id: t.id,
  customerName: t.customerName,
  location: t.location,
  content: t.content,
  rating: t.rating,
});

export const toAdminTestimonialResponse = (t: TestimonialProps): AdminTestimonialResponse => ({
  ...toTestimonialResponse(t),
  isPublished: t.isPublished,
  sortOrder: t.sortOrder,
  createdAt: t.createdAt,
});

/* ---------- Preguntas frecuentes ---------- */

export class FaqDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  question!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  answer!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateFaqDto extends PartialType(FaqDto) {}

export class FaqResponse {
  @ApiProperty() id!: string;
  @ApiProperty() question!: string;
  @ApiProperty() answer!: string;
}

export class AdminFaqResponse extends FaqResponse {
  @ApiProperty() isPublished!: boolean;
  @ApiProperty() sortOrder!: number;
}

export const toFaqResponse = (f: FaqProps): FaqResponse => ({
  id: f.id,
  question: f.question,
  answer: f.answer,
});
export const toAdminFaqResponse = (f: FaqProps): AdminFaqResponse => ({
  ...toFaqResponse(f),
  isPublished: f.isPublished,
  sortOrder: f.sortOrder,
});

/* ---------- Páginas ---------- */

export class PageDto {
  @ApiProperty({ example: 'tratamiento-de-datos' })
  @IsString()
  @MaxLength(80)
  slug!: string;

  @ApiProperty({ example: 'Política de tratamiento de datos' })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    description: 'Markdown: ## títulos, párrafos, listas con -, **negrita** y [enlaces](/ruta)',
  })
  @IsString()
  @MaxLength(60000)
  body!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdatePageDto extends PartialType(PageDto) {}

export class PageResponse {
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class AdminPageResponse extends PageResponse {
  @ApiProperty() id!: string;
  @ApiProperty() isPublished!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) publishedAt!: Date | null;
}

export const toPageResponse = (p: PageProps): PageResponse => ({
  slug: p.slug,
  title: p.title,
  body: p.body,
  updatedAt: p.updatedAt,
});
export const toAdminPageResponse = (p: PageProps): AdminPageResponse => ({
  ...toPageResponse(p),
  id: p.id,
  isPublished: p.isPublished,
  publishedAt: p.publishedAt,
});

/* ---------- Ajustes ---------- */

export class SocialLinkDto {
  @ApiProperty({ example: 'Instagram' })
  @IsString()
  @MaxLength(40)
  name!: string;

  @ApiProperty({ example: 'https://instagram.com/telarcasacarrillo' })
  @IsString()
  @MaxLength(500)
  url!: string;
}

export class StoreSettingsDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tagline?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactEmail?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  whatsapp?: string | null;

  @ApiPropertyOptional({ type: [SocialLinkDto] })
  @IsOptional()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => SocialLinkDto)
  socialLinks?: SocialLinkDto[];

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  storyTitle?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  storyBody?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  announcement?: string | null;
}

export class SocialLinkResponse {
  @ApiProperty() name!: string;
  @ApiProperty() url!: string;
}

export class PublicSettingsResponse {
  @ApiProperty({ nullable: true, type: String }) tagline!: string | null;
  @ApiProperty({ nullable: true, type: String }) location!: string | null;
  @ApiProperty({ nullable: true, type: String }) contactEmail!: string | null;
  @ApiProperty({ nullable: true, type: String }) contactPhone!: string | null;
  @ApiProperty({ nullable: true, type: String }) whatsapp!: string | null;
  @ApiProperty({ type: [SocialLinkResponse] }) socialLinks!: SocialLinkResponse[];
  @ApiProperty({ nullable: true, type: String }) storyTitle!: string | null;
  @ApiProperty({ nullable: true, type: String }) storyBody!: string | null;
  @ApiProperty({ nullable: true, type: String }) announcement!: string | null;
}

export const toSettingsResponse = (s: StoreSettings): PublicSettingsResponse => ({ ...s });

export const settingsFromDto = (dto: StoreSettingsDto): StoreSettings => ({
  tagline: dto.tagline ?? null,
  location: dto.location ?? null,
  contactEmail: dto.contactEmail ?? null,
  contactPhone: dto.contactPhone ?? null,
  whatsapp: dto.whatsapp ?? null,
  socialLinks: dto.socialLinks ?? [],
  storyTitle: dto.storyTitle ?? null,
  storyBody: dto.storyBody ?? null,
  announcement: dto.announcement ?? null,
});

/* ---------- Boletín ---------- */

export class SubscribeDto {
  @ApiProperty({ example: 'ana@correo.com' })
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ description: 'Debe ser true: aceptación del tratamiento de datos (Ley 1581)' })
  @IsBoolean()
  @Equals(true, { message: 'Debes aceptar el tratamiento de datos' })
  acceptPrivacy!: boolean;
}

export class NewsletterTokenDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  token!: string;
}

export class SubscriberQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Solo confirmados y activos', default: true })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  onlyActive?: boolean = true;
}

export class SubscriberResponse {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ type: String, format: 'date-time' }) consentAt!: Date;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) confirmedAt!: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) unsubscribedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class SubscriberPage {
  @ApiProperty({ type: [SubscriberResponse] }) items!: SubscriberResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export const toSubscriberResponse = (s: Subscriber): SubscriberResponse => ({
  id: s.id,
  email: s.email,
  consentAt: s.consentAt,
  confirmedAt: s.confirmedAt,
  unsubscribedAt: s.unsubscribedAt,
  createdAt: s.createdAt,
});

/* ---------- Contacto ---------- */

export class ContactDto {
  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiProperty() @IsEmail() @MaxLength(200) email!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  subject?: string | null;
  @ApiProperty() @IsString() @MaxLength(4000) message!: string;

  @ApiProperty({ description: 'Debe ser true (Ley 1581)' })
  @IsBoolean()
  @Equals(true, { message: 'Debes aceptar el tratamiento de datos' })
  acceptPrivacy!: boolean;
}

export const CONTACT_STATUSES = ['NEW', 'READ', 'ARCHIVED'] as const;

export class ContactQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: CONTACT_STATUSES })
  @IsOptional()
  @IsIn(CONTACT_STATUSES)
  status?: (typeof CONTACT_STATUSES)[number];
}

export class ContactStatusDto {
  @ApiProperty({ enum: CONTACT_STATUSES })
  @IsIn(CONTACT_STATUSES)
  status!: (typeof CONTACT_STATUSES)[number];
}

export class ContactMessageResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) subject!: string | null;
  @ApiProperty() message!: string;
  @ApiProperty({ enum: CONTACT_STATUSES }) status!: (typeof CONTACT_STATUSES)[number];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class ContactMessagePage {
  @ApiProperty({ type: [ContactMessageResponse] }) items!: ContactMessageResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export const toContactResponse = ({
  consentAt: _c,
  ...m
}: ContactMessageProps): ContactMessageResponse => m;

export class ReceivedResponse {
  @ApiProperty({ example: true }) ok!: boolean;
}
