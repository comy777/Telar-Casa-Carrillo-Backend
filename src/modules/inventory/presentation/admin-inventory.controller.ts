import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { actorOf } from '../../../shared/presentation/actor';
import {
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../../../shared/presentation/auth.decorators';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import { PERMISSIONS } from '../../identity/domain/permissions';
import { InventoryAdministration } from '../application/inventory-administration.service';
import {
  CountStockDto,
  InventoryItemResponse,
  InventoryPage,
  ListInventoryQuery,
  MovementPage,
  ReceiveStockDto,
  ThresholdDto,
} from './inventory.dto';

@ApiTags('admin: inventario')
@ApiBearerAuth()
@Controller('admin/inventory')
export class AdminInventoryController {
  constructor(private readonly inventory: InventoryAdministration) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Existencias por variante (filtros: agotado, pocas unidades)' })
  @ApiOkResponse({ type: InventoryPage })
  list(@Query() query: ListInventoryQuery): Promise<InventoryPage> {
    return this.inventory.list(query);
  }

  @Get(':variantId')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOkResponse({ type: InventoryItemResponse })
  get(@Param('variantId', ParseUUIDPipe) variantId: string): Promise<InventoryItemResponse> {
    return this.inventory.get(variantId);
  }

  @Get(':variantId/movements')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Historial de movimientos (más recientes primero)' })
  @ApiOkResponse({ type: MovementPage })
  movements(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Query() page: PaginationQuery,
  ): Promise<MovementPage> {
    return this.inventory.movements(variantId, page);
  }

  @Post(':variantId/receipts')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Registra una entrada de unidades' })
  @ApiOkResponse({ type: InventoryItemResponse })
  receive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: ReceiveStockDto,
    @Req() request: Request,
  ): Promise<InventoryItemResponse> {
    return this.inventory.receive(actorOf(user, request), variantId, body.quantity, body.reason);
  }

  @Put(':variantId/count')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Conteo físico: fija las existencias reales con un motivo' })
  @ApiOkResponse({ type: InventoryItemResponse })
  count(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: CountStockDto,
    @Req() request: Request,
  ): Promise<InventoryItemResponse> {
    return this.inventory.count(
      actorOf(user, request),
      variantId,
      body.quantityOnHand,
      body.reason,
    );
  }

  @Patch(':variantId')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @ApiOkResponse({ type: InventoryItemResponse })
  setThreshold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: ThresholdDto,
    @Req() request: Request,
  ): Promise<InventoryItemResponse> {
    return this.inventory.setThreshold(actorOf(user, request), variantId, body.lowStockThreshold);
  }
}
