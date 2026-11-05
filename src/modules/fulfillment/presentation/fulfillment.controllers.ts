import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { actorOf } from '../../../shared/presentation/actor';
import {
  type AuthenticatedUser,
  CurrentUser,
  MaybeCurrentUser,
  OptionalAuth,
  RequirePermissions,
} from '../../../shared/presentation/auth.decorators';
import { PERMISSIONS } from '../../identity/domain/permissions';
import { FulfillmentService, type ShipmentRecord } from '../application/fulfillment.service';
import { SHIPMENT_STATUSES, type ShipmentStatus } from '../domain/shipment';

export class CreateShipmentDto {
  @ApiProperty({ example: 'Servientrega' })
  @IsString()
  @MaxLength(80)
  carrier!: string;

  @ApiPropertyOptional({ example: '2048193377', description: 'Con guía, el pedido queda SHIPPED' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  trackingNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class TrackingEventDto {
  @ApiProperty({ enum: SHIPMENT_STATUSES })
  @IsIn(SHIPMENT_STATUSES)
  status!: ShipmentStatus;

  @ApiPropertyOptional({ example: 'En centro de distribución Barranquilla' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ description: 'Estado tal como lo reporta la transportadora' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  carrierStatus?: string;

  @ApiPropertyOptional({ type: Date })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;
}

export class TrackingEventResponse {
  @ApiProperty({ enum: SHIPMENT_STATUSES }) status!: ShipmentStatus;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) carrierStatus!: string | null;
  @ApiProperty() occurredAt!: Date;
}

export class ShipmentResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: SHIPMENT_STATUSES }) status!: ShipmentStatus;
  @ApiProperty({ nullable: true, type: String }) carrier!: string | null;
  @ApiProperty({ nullable: true, type: String }) trackingNumber!: string | null;
  @ApiProperty({ nullable: true, type: String }) shippingMethodName!: string | null;
  @ApiProperty({ nullable: true, type: Date }) shippedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) deliveredAt!: Date | null;
  @ApiProperty({ type: [TrackingEventResponse] }) events!: TrackingEventResponse[];
}

export class TrackingResponse {
  @ApiProperty() orderNumber!: string;
  @ApiProperty() orderStatus!: string;
  @ApiProperty({ type: [ShipmentResponse] }) shipments!: ShipmentResponse[];
}

const toShipment = ({
  orderId: _o,
  createdAt: _c,
  ...shipment
}: ShipmentRecord): ShipmentResponse => shipment;

@ApiTags('pedidos')
@OptionalAuth()
@Controller('orders/:orderNumber/tracking')
export class TrackingController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Seguimiento del pedido (con sesión o con el token del correo)' })
  @ApiQuery({ name: 'token', required: false })
  @ApiOkResponse({ type: TrackingResponse })
  async track(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Param('orderNumber') orderNumber: string,
    @Query('token') queryToken: string | undefined,
    @Headers('x-order-token') headerToken: string | undefined,
  ): Promise<TrackingResponse> {
    // El encabezado X-Order-Token evita que el token quede en historiales y logs.
    const token = headerToken ?? queryToken;
    const { order, shipments } = await this.fulfillment.trackingFor(
      orderNumber,
      user?.id ?? null,
      typeof token === 'string' && token.length >= 20 ? token : null,
    );
    return {
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      shipments: shipments.map(toShipment),
    };
  }
}

@ApiTags('admin: envíos')
@ApiBearerAuth()
@Controller('admin')
export class AdminShipmentsController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Get('orders/:id/shipments')
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  @ApiOkResponse({ type: [ShipmentResponse] })
  async list(@Param('id', ParseUUIDPipe) id: string): Promise<ShipmentResponse[]> {
    return (await this.fulfillment.listForOrder(id)).map(toShipment);
  }

  @Post('orders/:id/shipments')
  @RequirePermissions(PERMISSIONS.SHIPPING_MANAGE)
  @ApiOperation({ summary: 'Registra el despacho (transportadora y guía)' })
  @ApiOkResponse({ type: ShipmentResponse })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateShipmentDto,
    @Req() request: Request,
  ): Promise<ShipmentResponse> {
    return toShipment(await this.fulfillment.createShipment(actorOf(user, request), id, body));
  }

  @Post('shipments/:id/events')
  @RequirePermissions(PERMISSIONS.SHIPPING_MANAGE)
  @ApiOperation({ summary: 'Agrega un evento de seguimiento (DELIVERED deja el pedido entregado)' })
  @ApiOkResponse({ type: ShipmentResponse })
  async addEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TrackingEventDto,
    @Req() request: Request,
  ): Promise<ShipmentResponse> {
    return toShipment(await this.fulfillment.addEvent(actorOf(user, request), id, body));
  }
}
