import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Delete,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import { requestContextOf } from '../../../shared/presentation/request-context';
import { PERMISSIONS } from '../../identity/domain/permissions';
import { type Actor, ProductAdministration } from '../application/product-administration.service';
import { AcceptsImage, UploadedImage } from './image-upload';
import {
  provided,
  toAdminProduct,
  toNewVariant,
  toProductChanges,
  toVariantChanges,
} from './presenters';
import {
  AdminProductPage,
  AdminProductResponse,
  ChangeProductStatusDto,
  CreateProductDto,
  ListAdminProductsQuery,
  ProductImageFieldsDto,
  UpdateProductDto,
  UpdateProductImageDto,
  UpdateVariantDto,
  UploadProductImageDto,
  VariantDto,
} from './product.dto';

export const actorOf = (user: AuthenticatedUser, request: Request): Actor => ({
  id: user.id,
  context: requestContextOf(request),
});

@ApiTags('admin: catálogo')
@ApiBearerAuth()
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: ProductAdministration) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Lista productos en cualquier estado' })
  @ApiOkResponse({ type: AdminProductPage })
  async list(@Query() query: ListAdminProductsQuery): Promise<AdminProductPage> {
    const page = await this.products.list(query);
    return { ...page, items: page.items.map(toAdminProduct) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOkResponse({ type: AdminProductResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminProductResponse> {
    return toAdminProduct(await this.products.get(id));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Crea un producto en borrador con sus variantes' })
  @ApiCreatedResponse({ type: AdminProductResponse })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateProductDto,
    @Req() request: Request,
  ): Promise<AdminProductResponse> {
    const { variants, ...fields } = body;
    const changes = toProductChanges(fields);
    const product = await this.products.create(
      actorOf(user, request),
      { ...changes, name: body.name, sku: body.sku, description: body.description },
      variants.map(toNewVariant),
    );
    return toAdminProduct(product);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Edita los datos del producto (solo los campos enviados)' })
  @ApiOkResponse({ type: AdminProductResponse })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProductDto,
    @Req() request: Request,
  ): Promise<AdminProductResponse> {
    return toAdminProduct(
      await this.products.update(actorOf(user, request), id, toProductChanges(body)),
    );
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Publica (ACTIVE), despublica (DRAFT) o archiva',
    description: 'Publicar exige al menos una variante activa y una imagen.',
  })
  @ApiOkResponse({ type: AdminProductResponse })
  async changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeProductStatusDto,
    @Req() request: Request,
  ): Promise<AdminProductResponse> {
    return toAdminProduct(
      await this.products.changeStatus(actorOf(user, request), id, body.status),
    );
  }

  @Post(':id/variants')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiCreatedResponse({ type: AdminProductResponse })
  async addVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VariantDto,
    @Req() request: Request,
  ): Promise<AdminProductResponse> {
    return toAdminProduct(
      await this.products.addVariant(actorOf(user, request), id, toNewVariant(body)),
    );
  }

  @Patch(':id/variants/:variantId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Edita o desactiva una variante (no se borran)' })
  @ApiOkResponse({ type: AdminProductResponse })
  async updateVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: UpdateVariantDto,
    @Req() request: Request,
  ): Promise<AdminProductResponse> {
    return toAdminProduct(
      await this.products.updateVariant(
        actorOf(user, request),
        id,
        variantId,
        toVariantChanges(body),
      ),
    );
  }

  @Post(':id/images')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @AcceptsImage(UploadProductImageDto)
  @ApiOperation({ summary: 'Sube una imagen a la galería (la primera queda como principal)' })
  @ApiCreatedResponse({ type: AdminProductResponse })
  async addImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedImage() file: Express.Multer.File,
    @Body() body: ProductImageFieldsDto,
    @Req() request: Request,
  ): Promise<AdminProductResponse> {
    return toAdminProduct(
      await this.products.addImage(actorOf(user, request), id, {
        data: file.buffer,
        altText: body.altText,
        variantId: body.variantId,
      }),
    );
  }

  @Patch(':id/images/:imageId')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Cambia texto alternativo, orden, variante o imagen principal' })
  @ApiOkResponse({ type: AdminProductResponse })
  async updateImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() body: UpdateProductImageDto,
    @Req() request: Request,
  ): Promise<AdminProductResponse> {
    return toAdminProduct(
      await this.products.updateImage(
        actorOf(user, request),
        id,
        imageId,
        provided(body, ['altText', 'variantId']),
      ),
    );
  }

  @Delete(':id/images/:imageId')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Quita la imagen de la galería y borra el archivo' })
  @ApiOkResponse({ type: AdminProductResponse })
  async removeImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Req() request: Request,
  ): Promise<AdminProductResponse> {
    return toAdminProduct(await this.products.removeImage(actorOf(user, request), id, imageId));
  }
}
