import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { actorOf } from '../../../shared/presentation/actor';
import {
  type AuthenticatedUser,
  CurrentUser,
  MaybeCurrentUser,
  OptionalAuth,
  Public,
  RequirePermissions,
} from '../../../shared/presentation/auth.decorators';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import {
  applyGuestCookie,
  GUEST_CART_TTL_DAYS,
  guestKeyOf,
  SECURE_CART_COOKIE,
} from '../../cart/presentation/cart-cookie';
import { PERMISSIONS } from '../../identity/domain/permissions';
import { CheckoutService } from '../application/checkout.service';
import { CustomerOrders, OrderAdministration } from '../application/orders.services';
import {
  AdminOrderPage,
  AdminOrderResponse,
  ChangeOrderStatusDto,
  ListOrdersQuery,
  OrderPage,
  OrderResponse,
  PlacedOrderResponse,
  PlaceOrderDto,
  QuoteDto,
  QuoteResponse,
  RecordInvoiceDto,
  toAdminOrderResponse,
  toOrderResponse,
  toQuoteResponse,
} from './ordering.dto';

const ORDER_NUMBER = /^[A-Z]{2,6}-\d{6,}$/;

@ApiTags('checkout')
@OptionalAuth()
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    @Inject(SECURE_CART_COOKIE) private readonly secureCookie: boolean,
    @Inject(GUEST_CART_TTL_DAYS) private readonly ttlDays: number,
  ) {}

  @Post('quote')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Totales del carrito con envío y cupón, sin crear el pedido' })
  @ApiOkResponse({ type: QuoteResponse })
  async quote(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Body() body: QuoteDto,
    @Req() request: Request,
  ): Promise<QuoteResponse> {
    return toQuoteResponse(
      await this.checkout.quote(
        { userId: user?.id ?? null, guestKey: guestKeyOf(request) },
        user,
        body,
      ),
    );
  }

  @Post('orders')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Crea el pedido (PENDING_PAYMENT) a partir del carrito',
    description:
      'Aparta el stock hasta el plazo de pago, registra el cupón y vacía el carrito. ' +
      'El siguiente paso es iniciar el pago del pedido.',
  })
  @ApiOkResponse({ type: PlacedOrderResponse })
  async place(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Body() body: PlaceOrderDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlacedOrderResponse> {
    const placed = await this.checkout.placeOrder(
      { userId: user?.id ?? null, guestKey: guestKeyOf(request) },
      user,
      body,
    );
    applyGuestCookie(response, placed.cookie, this.secureCookie, this.ttlDays);
    return { order: toOrderResponse(placed.order), accessToken: placed.accessToken };
  }
}

@ApiTags('pedidos')
@Controller()
export class CustomerOrdersController {
  constructor(private readonly orders: CustomerOrders) {}

  @Get('account/orders')
  @ApiBearerAuth()
  @ApiOkResponse({ type: OrderPage })
  async mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: PaginationQuery,
  ): Promise<OrderPage> {
    const result = await this.orders.list(user.id, page);
    return { ...result, items: result.items.map(toOrderResponse) };
  }

  @Get('account/orders/:orderNumber')
  @ApiBearerAuth()
  @ApiOkResponse({ type: OrderResponse })
  async mineByNumber(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNumber') orderNumber: string,
  ): Promise<OrderResponse> {
    return toOrderResponse(await this.orders.getForUser(user.id, orderNumber.toUpperCase()));
  }

  @Get('orders/:orderNumber')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Pedido de un invitado, con el token del correo de confirmación' })
  @ApiQuery({ name: 'token', required: true })
  @ApiOkResponse({ type: OrderResponse })
  async guest(
    @Param('orderNumber') orderNumber: string,
    @Query('token') queryToken: string | undefined,
    @Headers('x-order-token') headerToken: string | undefined,
  ): Promise<OrderResponse> {
    // El encabezado X-Order-Token evita que el token quede en historiales y logs.
    const token = headerToken ?? queryToken;
    const number = orderNumber.toUpperCase();
    // Formato inválido o sin token: mismo 404 que un pedido inexistente.
    const valid = ORDER_NUMBER.test(number) && typeof token === 'string' && token.length >= 20;
    return toOrderResponse(
      await this.orders.getForGuest(valid ? number : '-', valid ? token : '-'),
    );
  }
}

@ApiTags('admin: pedidos')
@ApiBearerAuth()
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrderAdministration) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  @ApiOkResponse({ type: AdminOrderPage })
  async list(@Query() query: ListOrdersQuery): Promise<AdminOrderPage> {
    const page = await this.orders.list(query);
    return { ...page, items: page.items.map(toAdminOrderResponse) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  @ApiOkResponse({ type: AdminOrderResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminOrderResponse> {
    return toAdminOrderResponse(await this.orders.get(id));
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  @ApiOperation({
    summary: 'Avanza el pedido (PROCESSING, SHIPPED, DELIVERED) o cancela uno sin pagar',
    description: 'Cancelar un pedido pagado o devolverlo se hace con un reembolso.',
  })
  @ApiOkResponse({ type: AdminOrderResponse })
  async changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeOrderStatusDto,
    @Req() request: Request,
  ): Promise<AdminOrderResponse> {
    return toAdminOrderResponse(
      await this.orders.changeStatus(actorOf(user, request), id, body.status, body.note),
    );
  }

  @Put(':id/invoice')
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Registra la factura electrónica emitida fuera del sistema' })
  @ApiOkResponse({ type: AdminOrderResponse })
  async recordInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordInvoiceDto,
    @Req() request: Request,
  ): Promise<AdminOrderResponse> {
    return toAdminOrderResponse(
      await this.orders.recordInvoice(
        actorOf(user, request),
        id,
        body.invoiceNumber,
        body.cufe ?? null,
      ),
    );
  }
}
