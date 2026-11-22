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
  ApiAcceptedResponse,
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
import { ReceivedResponse } from '../../content/presentation/content.dto';
import { PERMISSIONS } from '../../identity/domain/permissions';
import { PublicVenue, QuoteDesk, VenueAdministration } from '../application/venue.services';
import {
  AdminVenueActivityResponse,
  CreateQuoteDto,
  CreateVenueActivityDto,
  QuoteRequestPage,
  QuoteQueryDto,
  QuoteRequestResponse,
  toAdminVenueActivityResponse,
  toQuoteRequestResponse,
  toVenueActivityResponse,
  toVenueSettingsResponse,
  UpdateQuoteDto,
  UpdateVenueActivityDto,
  VenueActivityImageDto,
  VenuePageResponse,
  VenueSettingsDto,
  VenueSettingsResponse,
  venueSettingsFromDto,
} from './venue.dto';

const CACHE = 'public, max-age=60';
/** Formularios públicos que envían correos: límite estricto por IP. */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

/** Solo copia las claves presentes en el cuerpo (PATCH parcial). */
function present<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;
}

@ApiTags('el lugar')
@Public()
@Controller('venue')
export class PublicVenueController {
  constructor(
    private readonly venue: PublicVenue,
    private readonly quotes: QuoteDesk,
  ) {}

  @Get()
  @Header('Cache-Control', CACHE)
  @ApiOperation({
    summary: '«Visítanos»: presentación, horario, ubicación y actividades publicadas',
  })
  @ApiOkResponse({ type: VenuePageResponse })
  async page(): Promise<VenuePageResponse> {
    const { settings, activities } = await this.venue.page();
    return {
      settings: toVenueSettingsResponse(settings),
      activities: activities.map(toVenueActivityResponse),
    };
  }

  @Post('quotes')
  @HttpCode(202)
  @Throttle(STRICT)
  @ApiOperation({
    summary: 'Solicitud de cotización: evento, visita de grupo o alquiler de cancha',
    description:
      'Avisa a la tienda y envía una confirmación a quien la pide. Errores 422 con code: CONSENT_REQUIRED, INVALID_EMAIL, INVALID_FIELD, INVALID_EVENT_DATE, EVENT_DATE_IN_PAST, INVALID_START_TIME, EVENT_DATE_REQUIRED, PEOPLE_REQUIRED, START_TIME_REQUIRED, DURATION_REQUIRED, ACTIVITY_NOT_AVAILABLE.',
  })
  @ApiAcceptedResponse({ type: ReceivedResponse })
  async requestQuote(@Body() body: CreateQuoteDto): Promise<ReceivedResponse> {
    await this.quotes.request(body);
    return { ok: true };
  }
}

@ApiTags('admin: el lugar')
@ApiBearerAuth()
@Controller('admin/venue')
export class AdminVenueController {
  constructor(private readonly admin: VenueAdministration) {}

  // Ajustes

  @Get('settings')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: VenueSettingsResponse })
  async settings(): Promise<VenueSettingsResponse> {
    return toVenueSettingsResponse(await this.admin.getSettings());
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOperation({
    summary: 'Reemplaza los ajustes de «Visítanos» (lo que no se envía queda vacío)',
  })
  @ApiOkResponse({ type: VenueSettingsResponse })
  async saveSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VenueSettingsDto,
    @Req() request: Request,
  ): Promise<VenueSettingsResponse> {
    return toVenueSettingsResponse(
      await this.admin.saveSettings(actorOf(user, request), venueSettingsFromDto(body)),
    );
  }

  // Actividades

  @Get('activities')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: [AdminVenueActivityResponse] })
  async activities(): Promise<AdminVenueActivityResponse[]> {
    return (await this.admin.listActivities()).map(toAdminVenueActivityResponse);
  }

  @Post('activities')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiCreatedResponse({ type: AdminVenueActivityResponse })
  async createActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateVenueActivityDto,
    @Req() request: Request,
  ): Promise<AdminVenueActivityResponse> {
    return toAdminVenueActivityResponse(
      await this.admin.createActivity(actorOf(user, request), {
        name: body.name,
        kind: body.kind ?? 'OTHER',
        description: body.description ?? null,
        imageAlt: null,
        isPublished: body.isPublished ?? true,
        sortOrder: body.sortOrder ?? 0,
      }),
    );
  }

  @Patch('activities/:id')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOkResponse({ type: AdminVenueActivityResponse })
  async updateActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateVenueActivityDto,
    @Req() request: Request,
  ): Promise<AdminVenueActivityResponse> {
    return toAdminVenueActivityResponse(
      await this.admin.updateActivity(actorOf(user, request), id, present(body)),
    );
  }

  @Put('activities/:id/image')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @AcceptsImage(VenueActivityImageDto)
  @ApiOperation({ summary: 'Sube o reemplaza la imagen (borra la anterior)' })
  @ApiOkResponse({ type: AdminVenueActivityResponse })
  async replaceActivityImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedImage() file: Express.Multer.File,
    @Req() request: Request,
  ): Promise<AdminVenueActivityResponse> {
    return toAdminVenueActivityResponse(
      await this.admin.replaceActivityImage(actorOf(user, request), id, file.buffer),
    );
  }

  @Delete('activities/:id/image')
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiOperation({ summary: 'Quita la imagen de la actividad' })
  @ApiOkResponse({ type: AdminVenueActivityResponse })
  async removeActivityImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<AdminVenueActivityResponse> {
    return toAdminVenueActivityResponse(
      await this.admin.removeActivityImage(actorOf(user, request), id),
    );
  }

  @Delete('activities/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  @ApiNoContentResponse()
  async deleteActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.deleteActivity(actorOf(user, request), id);
  }
}

@ApiTags('admin: cotizaciones')
@ApiBearerAuth()
@Controller('admin/quotes')
export class AdminQuotesController {
  constructor(private readonly quotes: QuoteDesk) {}

  @Get()
  @RequirePermissions(PERMISSIONS.QUOTES_READ)
  @ApiOperation({ summary: 'Solicitudes de cotización, más recientes primero' })
  @ApiOkResponse({ type: QuoteRequestPage })
  async list(@Query() query: QuoteQueryDto): Promise<QuoteRequestPage> {
    const { items, total } = await this.quotes.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: items.map(toQuoteRequestResponse),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.QUOTES_READ)
  @ApiOkResponse({ type: QuoteRequestResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<QuoteRequestResponse> {
    return toQuoteRequestResponse(await this.quotes.get(id));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  @ApiOperation({ summary: 'Cambia el estado o las notas internas' })
  @ApiOkResponse({ type: QuoteRequestResponse })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateQuoteDto,
    @Req() request: Request,
  ): Promise<QuoteRequestResponse> {
    return toQuoteRequestResponse(
      await this.quotes.update(actorOf(user, request), id, present(body)),
    );
  }
}
