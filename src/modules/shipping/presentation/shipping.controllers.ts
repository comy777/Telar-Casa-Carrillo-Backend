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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { actorOf } from '../../../shared/presentation/actor';
import {
  type AuthenticatedUser,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../../shared/presentation/auth.decorators';
import { pesosToCents } from '../../catalog/domain/money';
import { PERMISSIONS } from '../../identity/domain/permissions';
import { AddressBook, ShippingMethods } from '../application/shipping.services';
import type { ShippingMethodInput } from '../domain/shipping-method';
import {
  AddressResponse,
  SavedAddressDto,
  ShippingMethodDto,
  ShippingMethodResponse,
  toAddressResponse,
  toShippingMethodResponse,
  UpdateShippingMethodDto,
} from './shipping.dto';

@ApiTags('cuenta')
@ApiBearerAuth()
@Controller('account/addresses')
export class AddressBookController {
  constructor(private readonly addresses: AddressBook) {}

  @Get()
  @ApiOkResponse({ type: [AddressResponse] })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<AddressResponse[]> {
    return (await this.addresses.list(user.id)).map(toAddressResponse);
  }

  @Post()
  @ApiOkResponse({ type: AddressResponse })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SavedAddressDto,
  ): Promise<AddressResponse> {
    return toAddressResponse(await this.addresses.create(user.id, body));
  }

  @Put(':id')
  @ApiOkResponse({ type: AddressResponse })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SavedAddressDto,
  ): Promise<AddressResponse> {
    return toAddressResponse(await this.addresses.update(user.id, id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.addresses.remove(user.id, id);
  }
}

@ApiTags('envíos')
@Public()
@Controller('shipping/methods')
export class ShippingMethodsController {
  constructor(private readonly methods: ShippingMethods) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Métodos de envío activos con su costo' })
  @ApiOkResponse({ type: [ShippingMethodResponse] })
  async list(): Promise<ShippingMethodResponse[]> {
    return (await this.methods.list(true)).map(toShippingMethodResponse);
  }
}

function toInput(dto: Partial<ShippingMethodDto>): Partial<ShippingMethodInput> {
  const input: Partial<ShippingMethodInput> = {};
  if (dto.name !== undefined && dto.name !== null) input.name = dto.name;
  if (dto.description !== undefined) input.description = dto.description;
  if (dto.basePrice !== undefined && dto.basePrice !== null) {
    input.basePriceCents = pesosToCents(dto.basePrice);
  }
  if (dto.freeShippingThreshold !== undefined) {
    input.freeShippingThresholdCents =
      dto.freeShippingThreshold === null ? null : pesosToCents(dto.freeShippingThreshold);
  }
  if (dto.estimatedDelivery !== undefined) input.estimatedDelivery = dto.estimatedDelivery;
  if (dto.isActive !== undefined && dto.isActive !== null) input.isActive = dto.isActive;
  if (dto.sortOrder !== undefined && dto.sortOrder !== null) input.sortOrder = dto.sortOrder;
  return input;
}

@ApiTags('admin: envíos')
@ApiBearerAuth()
@Controller('admin/shipping-methods')
export class AdminShippingMethodsController {
  constructor(private readonly methods: ShippingMethods) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SHIPPING_MANAGE)
  @ApiOkResponse({ type: [ShippingMethodResponse] })
  async list(): Promise<ShippingMethodResponse[]> {
    return (await this.methods.list(false)).map(toShippingMethodResponse);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SHIPPING_MANAGE)
  @ApiOkResponse({ type: ShippingMethodResponse })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ShippingMethodDto,
    @Req() request: Request,
  ): Promise<ShippingMethodResponse> {
    const input = toInput(body);
    return toShippingMethodResponse(
      await this.methods.create(actorOf(user, request), {
        name: body.name,
        basePriceCents: pesosToCents(body.basePrice),
        description: input.description ?? null,
        freeShippingThresholdCents: input.freeShippingThresholdCents ?? null,
        estimatedDelivery: input.estimatedDelivery ?? null,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
      }),
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SHIPPING_MANAGE)
  @ApiOkResponse({ type: ShippingMethodResponse })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateShippingMethodDto,
    @Req() request: Request,
  ): Promise<ShippingMethodResponse> {
    return toShippingMethodResponse(
      await this.methods.update(actorOf(user, request), id, toInput(body)),
    );
  }
}
