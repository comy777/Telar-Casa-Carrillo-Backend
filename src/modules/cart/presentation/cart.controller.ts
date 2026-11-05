import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  type AuthenticatedUser,
  MaybeCurrentUser,
  OptionalAuth,
} from '../../../shared/presentation/auth.decorators';
import { type CartIdentity, type CartOutcome, CartService } from '../application/cart.service';
import {
  applyGuestCookie,
  GUEST_CART_TTL_DAYS,
  guestKeyOf,
  SECURE_CART_COOKIE,
} from './cart-cookie';
import { AddCartItemDto, CartResponse, SetCartItemDto, toCartResponse } from './cart.dto';

/**
 * Carrito con o sin sesión. Sin sesión se identifica con la cookie HttpOnly
 * `tcc_cart`; al iniciar sesión, el carrito de invitado se incorpora al de la
 * cuenta en la siguiente petición. El frontend debe usar `credentials: 'include'`.
 */
@ApiTags('carrito')
@OptionalAuth()
@Controller('cart')
export class CartController {
  constructor(
    private readonly carts: CartService,
    @Inject(SECURE_CART_COOKIE) private readonly secureCookie: boolean,
    @Inject(GUEST_CART_TTL_DAYS) private readonly ttlDays: number,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Carrito con precios y disponibilidad revalidados' })
  @ApiOkResponse({ type: CartResponse })
  get(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartResponse> {
    return this.respond(response, this.carts.get(this.identity(user, request)));
  }

  @Post('items')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Agrega unidades (se suman si la variante ya está)' })
  @ApiOkResponse({ type: CartResponse })
  add(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Body() body: AddCartItemDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartResponse> {
    return this.respond(
      response,
      this.carts.addItem(this.identity(user, request), body.variantId, body.quantity),
    );
  }

  @Patch('items/:variantId')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CartResponse })
  setQuantity(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: SetCartItemDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartResponse> {
    return this.respond(
      response,
      this.carts.setQuantity(this.identity(user, request), variantId, body.quantity),
    );
  }

  @Delete('items/:variantId')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CartResponse })
  remove(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartResponse> {
    return this.respond(response, this.carts.removeItem(this.identity(user, request), variantId));
  }

  @Delete()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CartResponse })
  clear(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartResponse> {
    return this.respond(response, this.carts.clear(this.identity(user, request)));
  }

  @Post('reservation')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Inicia el checkout: aparta el stock del carrito por unos minutos',
    description:
      'Todo o nada. Responde 422 INSUFFICIENT_STOCK o CART_HAS_ISSUES si algo no alcanza. ' +
      'Cualquier cambio posterior al carrito libera la reserva.',
  })
  @ApiOkResponse({ type: CartResponse })
  reserve(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartResponse> {
    return this.respond(response, this.carts.reserve(this.identity(user, request)));
  }

  @Delete('reservation')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Abandona el checkout y devuelve el stock apartado' })
  @ApiOkResponse({ type: CartResponse })
  release(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartResponse> {
    return this.respond(response, this.carts.releaseReservation(this.identity(user, request)));
  }

  private identity(user: AuthenticatedUser | null, request: Request): CartIdentity {
    return { userId: user?.id ?? null, guestKey: guestKeyOf(request) };
  }

  private async respond(response: Response, outcome: Promise<CartOutcome>): Promise<CartResponse> {
    const { view, cookie } = await outcome;
    applyGuestCookie(response, cookie, this.secureCookie, this.ttlDays);
    return toCartResponse(view);
  }
}
