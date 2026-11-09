import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { actorOf } from '../../../shared/presentation/actor';
import {
  type AuthenticatedUser,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../../shared/presentation/auth.decorators';
import { AcceptsImage, UploadedImage } from '../../catalog/presentation/image-upload';
import { PERMISSIONS } from '../../identity/domain/permissions';
import {
  ContactInbox,
  ContentAdministration,
  Newsletter,
  PublicContent,
} from '../application/content.services';
import type { BannerInput, FaqInput, PageInput, TestimonialInput } from '../domain/content';
import {
  AdminBannerResponse,
  AdminFaqResponse,
  AdminPageResponse,
  AdminStoreRouteResponse,
  StoreRouteResponse,
  toAdminStoreRouteResponse,
  toStoreRouteResponse,
  UpdateStoreRouteDto,
  AdminTestimonialResponse,
  BannerResponse,
  ContactDto,
  ContactMessagePage,
  ContactMessageResponse,
  ContactQuery,
  ContactStatusDto,
  CreateBannerDto,
  FaqDto,
  FaqResponse,
  NewsletterTokenDto,
  PageDto,
  PageLinkResponse,
  PageResponse,
  PublicSettingsResponse,
  ReceivedResponse,
  settingsFromDto,
  StoreSettingsDto,
  SubscribeDto,
  SubscriberPage,
  SubscriberQuery,
  TestimonialDto,
  TestimonialResponse,
  toAdminBannerResponse,
  toAdminFaqResponse,
  toAdminPageResponse,
  toAdminTestimonialResponse,
  toBannerResponse,
  toContactResponse,
  toFaqResponse,
  toPageLinkResponse,
  toPageResponse,
  toSettingsResponse,
  toSubscriberResponse,
  toTestimonialResponse,
  UpdateBannerDto,
  UpdateFaqDto,
  UpdatePageDto,
  UpdateTestimonialDto,
} from './content.dto';

const CACHE = 'public, max-age=60';
/** Formularios públicos que envían correos: límite estricto por IP. */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

/** Solo copia las claves presentes en el cuerpo (PATCH parcial). */
function present<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;
}

@ApiTags('contenido')
@Public()
@Controller('content')
export class PublicContentController {
  constructor(
    private readonly content: PublicContent,
    private readonly newsletter: Newsletter,
  ) {}

  @Get('settings')
  @Header('Cache-Control', CACHE)
  @ApiOperation({ summary: 'Ajustes públicos: contacto, redes, historia y aviso' })
  @ApiOkResponse({ type: PublicSettingsResponse })
  async settings(): Promise<PublicSettingsResponse> {
    return toSettingsResponse(await this.content.settings());
  }

  @Get('navigation')
  @Header('Cache-Control', CACHE)
  @ApiOperation({
    summary: 'Rutas del storefront: cuáles están activas y dónde van en el menú y el pie',
  })
  @ApiOkResponse({ type: [StoreRouteResponse] })
  async navigation(): Promise<StoreRouteResponse[]> {
    return (await this.content.navigation()).map(toStoreRouteResponse);
  }

  @Get('banners')
  @Header('Cache-Control', CACHE)
  @ApiOperation({ summary: 'Banners vigentes, en orden' })
  @ApiOkResponse({ type: [BannerResponse] })
  async banners(): Promise<BannerResponse[]> {
    return (await this.content.banners()).map(toBannerResponse);
  }

  @Get('testimonials')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: [TestimonialResponse] })
  async testimonials(): Promise<TestimonialResponse[]> {
    return (await this.content.testimonials()).map(toTestimonialResponse);
  }

  @Get('faqs')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: [FaqResponse] })
  async faqs(): Promise<FaqResponse[]> {
    return (await this.content.faqs()).map(toFaqResponse);
  }

  @Get('pages')
  @Header('Cache-Control', CACHE)
  @ApiOperation({
    summary: 'Páginas publicadas (título y enlace), para el pie y el mapa del sitio',
  })
  @ApiOkResponse({ type: [PageLinkResponse] })
  async pages(): Promise<PageLinkResponse[]> {
    return (await this.content.pages()).map(toPageLinkResponse);
  }

  @Get('pages/:slug')
  @Header('Cache-Control', CACHE)
  @ApiOperation({ summary: 'Página publicada (políticas, nosotros...)' })
  @ApiOkResponse({ type: PageResponse })
  async page(@Param('slug') slug: string): Promise<PageResponse> {
    return toPageResponse(await this.content.page(slug));
  }

  @Post('newsletter')
  @HttpCode(202)
  @Throttle(STRICT)
  @ApiOperation({ summary: 'Suscribe y envía el enlace de confirmación (doble confirmación)' })
  @ApiOkResponse({ type: ReceivedResponse })
  async subscribe(@Body() body: SubscribeDto): Promise<ReceivedResponse> {
    await this.newsletter.subscribe(body.email, body.acceptPrivacy);
    return { ok: true };
  }

  @Post('newsletter/confirm')
  @HttpCode(200)
  @ApiOkResponse({ type: ReceivedResponse })
  async confirm(@Body() body: NewsletterTokenDto): Promise<ReceivedResponse> {
    await this.newsletter.confirm(body.token);
    return { ok: true };
  }

  @Post('newsletter/unsubscribe')
  @HttpCode(200)
  @ApiOkResponse({ type: ReceivedResponse })
  async unsubscribe(@Body() body: NewsletterTokenDto): Promise<ReceivedResponse> {
    await this.newsletter.unsubscribe(body.token);
    return { ok: true };
  }
}

@ApiTags('contenido')
@Public()
@Controller('contact')
export class ContactController {
  constructor(private readonly inbox: ContactInbox) {}

  @Post()
  @HttpCode(202)
  @Throttle(STRICT)
  @ApiOperation({ summary: 'Mensaje del formulario de contacto' })
  @ApiOkResponse({ type: ReceivedResponse })
  async send(@Body() body: ContactDto): Promise<ReceivedResponse> {
    await this.inbox.receive(body, body.acceptPrivacy);
    return { ok: true };
  }
}

@ApiTags('admin: contenido')
@ApiBearerAuth()
@Controller('admin/content')
export class AdminContentController {
  constructor(private readonly admin: ContentAdministration) {}

  // Banners

  @Get('banners')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: [AdminBannerResponse] })
  async banners(): Promise<AdminBannerResponse[]> {
    return (await this.admin.listBanners()).map(toAdminBannerResponse);
  }

  @Post('banners')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @AcceptsImage(CreateBannerDto)
  @ApiCreatedResponse({ type: AdminBannerResponse })
  async createBanner(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateBannerDto,
    @UploadedImage() file: Express.Multer.File,
    @Req() request: Request,
  ): Promise<AdminBannerResponse> {
    const input: BannerInput = {
      title: body.title,
      subtitle: body.subtitle ?? null,
      imageAlt: body.imageAlt ?? null,
      targetUrl: body.targetUrl ?? null,
      ctaLabel: body.ctaLabel ?? null,
      isActive: body.isActive ?? true,
      startsAt: body.startsAt ?? null,
      endsAt: body.endsAt ?? null,
      sortOrder: body.sortOrder ?? 0,
    };
    return toAdminBannerResponse(
      await this.admin.createBanner(actorOf(user, request), input, file.buffer),
    );
  }

  @Patch('banners/:id')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: AdminBannerResponse })
  async updateBanner(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBannerDto,
    @Req() request: Request,
  ): Promise<AdminBannerResponse> {
    return toAdminBannerResponse(
      await this.admin.updateBanner(actorOf(user, request), id, present(body)),
    );
  }

  @Put('banners/:id/image')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @AcceptsImage(CreateBannerDto)
  @ApiOkResponse({ type: AdminBannerResponse })
  async replaceBannerImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedImage() file: Express.Multer.File,
    @Req() request: Request,
  ): Promise<AdminBannerResponse> {
    return toAdminBannerResponse(
      await this.admin.replaceBannerImage(actorOf(user, request), id, file.buffer),
    );
  }

  @Delete('banners/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiNoContentResponse()
  async deleteBanner(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.deleteBanner(actorOf(user, request), id);
  }

  // Testimonios

  @Get('testimonials')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: [AdminTestimonialResponse] })
  async testimonials(): Promise<AdminTestimonialResponse[]> {
    return (await this.admin.listTestimonials()).map(toAdminTestimonialResponse);
  }

  @Post('testimonials')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiCreatedResponse({ type: AdminTestimonialResponse })
  async createTestimonial(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TestimonialDto,
    @Req() request: Request,
  ): Promise<AdminTestimonialResponse> {
    const input: TestimonialInput = {
      customerName: body.customerName,
      location: body.location ?? null,
      content: body.content,
      rating: body.rating ?? null,
      isPublished: body.isPublished ?? false,
      sortOrder: body.sortOrder ?? 0,
    };
    return toAdminTestimonialResponse(
      await this.admin.createTestimonial(actorOf(user, request), input),
    );
  }

  @Patch('testimonials/:id')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: AdminTestimonialResponse })
  async updateTestimonial(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTestimonialDto,
    @Req() request: Request,
  ): Promise<AdminTestimonialResponse> {
    return toAdminTestimonialResponse(
      await this.admin.updateTestimonial(actorOf(user, request), id, present(body)),
    );
  }

  @Delete('testimonials/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiNoContentResponse()
  async deleteTestimonial(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.deleteTestimonial(actorOf(user, request), id);
  }

  // Preguntas frecuentes

  @Get('faqs')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: [AdminFaqResponse] })
  async faqs(): Promise<AdminFaqResponse[]> {
    return (await this.admin.listFaqs()).map(toAdminFaqResponse);
  }

  @Post('faqs')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiCreatedResponse({ type: AdminFaqResponse })
  async createFaq(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: FaqDto,
    @Req() request: Request,
  ): Promise<AdminFaqResponse> {
    const input: FaqInput = {
      question: body.question,
      answer: body.answer,
      isPublished: body.isPublished ?? false,
      sortOrder: body.sortOrder ?? 0,
    };
    return toAdminFaqResponse(await this.admin.createFaq(actorOf(user, request), input));
  }

  @Patch('faqs/:id')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: AdminFaqResponse })
  async updateFaq(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateFaqDto,
    @Req() request: Request,
  ): Promise<AdminFaqResponse> {
    return toAdminFaqResponse(
      await this.admin.updateFaq(actorOf(user, request), id, present(body)),
    );
  }

  @Delete('faqs/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiNoContentResponse()
  async deleteFaq(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.deleteFaq(actorOf(user, request), id);
  }

  // Páginas

  @Get('pages')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: [AdminPageResponse] })
  async pages(): Promise<AdminPageResponse[]> {
    return (await this.admin.listPages()).map(toAdminPageResponse);
  }

  @Get('pages/:id')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: AdminPageResponse })
  async pageById(@Param('id', ParseUUIDPipe) id: string): Promise<AdminPageResponse> {
    return toAdminPageResponse(await this.admin.getPage(id));
  }

  @Post('pages')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiCreatedResponse({ type: AdminPageResponse })
  async createPage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PageDto,
    @Req() request: Request,
  ): Promise<AdminPageResponse> {
    const input: PageInput = {
      slug: body.slug,
      title: body.title,
      body: body.body,
      isPublished: body.isPublished ?? false,
    };
    return toAdminPageResponse(await this.admin.createPage(actorOf(user, request), input));
  }

  @Patch('pages/:id')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: AdminPageResponse })
  async updatePage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePageDto,
    @Req() request: Request,
  ): Promise<AdminPageResponse> {
    return toAdminPageResponse(
      await this.admin.updatePage(actorOf(user, request), id, present(body)),
    );
  }

  @Delete('pages/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiNoContentResponse()
  async deletePage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.deletePage(actorOf(user, request), id);
  }

  // Navegación del storefront

  @Get('navigation')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: [AdminStoreRouteResponse] })
  async routes(): Promise<AdminStoreRouteResponse[]> {
    return (await this.admin.listRoutes()).map(toAdminStoreRouteResponse);
  }

  @Patch('navigation/:key')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOperation({ summary: 'Activa, desactiva, renombra o reubica una ruta del storefront' })
  @ApiOkResponse({ type: AdminStoreRouteResponse })
  async updateRoute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() body: UpdateStoreRouteDto,
    @Req() request: Request,
  ): Promise<AdminStoreRouteResponse> {
    return toAdminStoreRouteResponse(
      await this.admin.updateRoute(actorOf(user, request), key, present(body)),
    );
  }

  // Ajustes

  @Get('settings')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: PublicSettingsResponse })
  async settings(): Promise<PublicSettingsResponse> {
    return toSettingsResponse(await this.admin.getSettings());
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: PublicSettingsResponse })
  async saveSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StoreSettingsDto,
    @Req() request: Request,
  ): Promise<PublicSettingsResponse> {
    return toSettingsResponse(
      await this.admin.saveSettings(actorOf(user, request), settingsFromDto(body)),
    );
  }
}

@ApiTags('admin: mensajes')
@ApiBearerAuth()
@Controller('admin')
export class AdminMessagesController {
  constructor(
    private readonly inbox: ContactInbox,
    private readonly newsletter: Newsletter,
  ) {}

  @Get('contact-messages')
  @RequirePermissions(PERMISSIONS.MESSAGES_READ)
  @ApiOkResponse({ type: ContactMessagePage })
  async messages(@Query() query: ContactQuery): Promise<ContactMessagePage> {
    const { items, total } = await this.inbox.list({
      ...(query.status ? { status: query.status } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: items.map(toContactResponse),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  @Patch('contact-messages/:id')
  @RequirePermissions(PERMISSIONS.MESSAGES_READ)
  @ApiOkResponse({ type: ContactMessageResponse })
  async setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ContactStatusDto,
    @Req() request: Request,
  ): Promise<ContactMessageResponse> {
    return toContactResponse(await this.inbox.setStatus(actorOf(user, request), id, body.status));
  }

  @Get('newsletter-subscribers')
  @RequirePermissions(PERMISSIONS.MESSAGES_READ)
  @ApiOkResponse({ type: SubscriberPage })
  async subscribers(@Query() query: SubscriberQuery): Promise<SubscriberPage> {
    const { items, total } = await this.newsletter.list({
      page: query.page,
      pageSize: query.pageSize,
      onlyActive: query.onlyActive ?? true,
    });
    return {
      items: items.map(toSubscriberResponse),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
