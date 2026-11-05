import {
  Body,
  Controller,
  Delete,
  Get,
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
import type { Request } from 'express';
import {
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../../../shared/presentation/auth.decorators';
import { PERMISSIONS } from '../../identity/domain/permissions';
import {
  ArtisanAdministration,
  CategoryAdministration,
} from '../application/taxonomy-administration.service';
import { actorOf } from './admin-products.controller';
import { AcceptsImage, UploadedImage } from './image-upload';
import { provided, toAdminArtisan, toAdminCategory } from './presenters';
import {
  AdminArtisanPage,
  AdminArtisanResponse,
  AdminCategoryResponse,
  CreateArtisanDto,
  CreateCategoryDto,
  ImageUploadDto,
  ListAdminArtisansQuery,
  UpdateArtisanDto,
  UpdateCategoryDto,
} from './taxonomy.dto';

@ApiTags('admin: catálogo')
@ApiBearerAuth()
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoryAdministration) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Todas las categorías (lista plana con parentId)' })
  @ApiOkResponse({ type: [AdminCategoryResponse] })
  async list(): Promise<AdminCategoryResponse[]> {
    return (await this.categories.list()).map(toAdminCategory);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiCreatedResponse({ type: AdminCategoryResponse })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateCategoryDto,
    @Req() request: Request,
  ): Promise<AdminCategoryResponse> {
    const { parentId, ...details } = provided(body, ['description', 'parentId']);
    return toAdminCategory(
      await this.categories.create(
        actorOf(user, request),
        { ...details, name: body.name },
        parentId ?? null,
      ),
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Edita, mueve (parentId) o desactiva una categoría' })
  @ApiOkResponse({ type: AdminCategoryResponse })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCategoryDto,
    @Req() request: Request,
  ): Promise<AdminCategoryResponse> {
    const { parentId, ...changes } = provided(body, ['description', 'parentId']);
    return toAdminCategory(
      await this.categories.update(actorOf(user, request), id, changes, parentId),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Borra una categoría sin subcategorías ni productos' })
  @ApiNoContentResponse()
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.categories.delete(actorOf(user, request), id);
  }

  @Put(':id/image')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @AcceptsImage(ImageUploadDto)
  @ApiOkResponse({ type: AdminCategoryResponse })
  async setImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedImage() file: Express.Multer.File,
    @Req() request: Request,
  ): Promise<AdminCategoryResponse> {
    return toAdminCategory(await this.categories.setImage(actorOf(user, request), id, file.buffer));
  }

  @Delete(':id/image')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOkResponse({ type: AdminCategoryResponse })
  async removeImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<AdminCategoryResponse> {
    return toAdminCategory(await this.categories.removeImage(actorOf(user, request), id));
  }
}

@ApiTags('admin: catálogo')
@ApiBearerAuth()
@Controller('admin/artisans')
export class AdminArtisansController {
  constructor(private readonly artisans: ArtisanAdministration) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOkResponse({ type: AdminArtisanPage })
  async list(@Query() query: ListAdminArtisansQuery): Promise<AdminArtisanPage> {
    const page = await this.artisans.list(query);
    return { ...page, items: page.items.map(toAdminArtisan) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOkResponse({ type: AdminArtisanResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminArtisanResponse> {
    return toAdminArtisan(await this.artisans.get(id));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiCreatedResponse({ type: AdminArtisanResponse })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateArtisanDto,
    @Req() request: Request,
  ): Promise<AdminArtisanResponse> {
    const details = provided(body, ['biography', 'story']);
    return toAdminArtisan(
      await this.artisans.create(actorOf(user, request), { ...details, name: body.name }),
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOkResponse({ type: AdminArtisanResponse })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateArtisanDto,
    @Req() request: Request,
  ): Promise<AdminArtisanResponse> {
    return toAdminArtisan(
      await this.artisans.update(
        actorOf(user, request),
        id,
        provided(body, ['biography', 'story']),
      ),
    );
  }

  @Put(':id/photo')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @AcceptsImage(ImageUploadDto)
  @ApiOkResponse({ type: AdminArtisanResponse })
  async setPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedImage() file: Express.Multer.File,
    @Req() request: Request,
  ): Promise<AdminArtisanResponse> {
    return toAdminArtisan(await this.artisans.setPhoto(actorOf(user, request), id, file.buffer));
  }

  @Delete(':id/photo')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOkResponse({ type: AdminArtisanResponse })
  async removePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<AdminArtisanResponse> {
    return toAdminArtisan(await this.artisans.removePhoto(actorOf(user, request), id));
  }
}
