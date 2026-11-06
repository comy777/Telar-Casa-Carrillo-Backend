import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Request } from 'express';
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
import { centsToPesos, pesosToCents } from '../../catalog/domain/money';
import { ToBoolean } from '../../catalog/presentation/validators';
import { PERMISSIONS } from '../../identity/domain/permissions';
import { OrderResponse, toOrderResponse } from '../../ordering/presentation/ordering.dto';
import type { PaymentRecord, RefundRecord } from '../application/ports';
import { PaymentsService } from '../application/payments.service';
import { type PaymentDetail, RefundsService } from '../application/refunds.service';
import type { PaymentStatus } from '../domain/payment';

const PAYMENT_STATUSES: PaymentStatus[] = [
  'PENDING',
  'APPROVED',
  'DECLINED',
  'VOIDED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'ERROR',
];

// ---------- DTO ----------

export class OrderAccessDto {
  @ApiPropertyOptional({ description: 'Invitados: el token del correo de confirmación' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  token?: string;
}

export class ConfirmPaymentDto extends OrderAccessDto {
  @ApiProperty({ description: 'El id que la pasarela agrega al volver (?id=...)' })
  @IsString()
  @MinLength(5)
  @MaxLength(100)
  transactionId!: string;
}

export class WidgetSignature {
  @ApiProperty() integrity!: string;
}

/** Parámetros del Widget de Wompi (checkout.wompi.co/widget.js). */
export class WompiWidgetParams {
  @ApiProperty() publicKey!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() amountInCents!: number;
  @ApiProperty() reference!: string;
  @ApiProperty({ type: WidgetSignature }) signature!: WidgetSignature;
  @ApiProperty() redirectUrl!: string;
  @ApiProperty({ nullable: true, type: String }) expirationTime!: string | null;
}

export class StartPaymentResponse {
  @ApiProperty({ enum: ['checkout', 'free'], description: 'free: total 0, ya quedó pagado' })
  kind!: 'checkout' | 'free';
  @ApiPropertyOptional() reference?: string;
  @ApiPropertyOptional({ description: 'URL del Web Checkout (redirigir al cliente aquí)' })
  checkoutUrl?: string;
  @ApiPropertyOptional({
    type: WompiWidgetParams,
    description: 'Parámetros para el Widget de Wompi',
  })
  widget?: WompiWidgetParams;
  @ApiPropertyOptional({ type: OrderResponse }) order?: OrderResponse;
}

export class RefundDto {
  @ApiPropertyOptional({ description: 'Pesos; sin él se devuelve todo lo que queda' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999)
  amount?: number;

  @ApiProperty({ example: 'Retracto del cliente (Ley 1480)' })
  @IsString()
  @MaxLength(300)
  reason!: string;

  @ApiPropertyOptional({ default: false, description: 'Devolver las unidades al inventario' })
  @IsOptional()
  @IsBoolean()
  restock?: boolean;
}

export class ResolveRefundDto {
  @ApiProperty({ enum: ['APPROVED', 'FAILED'] })
  @IsIn(['APPROVED', 'FAILED'])
  status!: 'APPROVED' | 'FAILED';

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  restock?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ListPaymentsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: PaymentStatus;

  @ApiPropertyOptional({ description: 'Pagos que requieren revisión (normalmente reembolso)' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  needsReview?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  orderNumber?: string;
}

export class RefundResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'FAILED'] }) status!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ nullable: true, type: String }) failureReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) providerReference!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class PaymentResponse {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() reference!: string;
  @ApiProperty({ nullable: true, type: String }) transactionId!: string | null;
  @ApiProperty({ enum: PAYMENT_STATUSES }) status!: PaymentStatus;
  @ApiProperty() amount!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: String }) paymentMethodType!: string | null;
  @ApiProperty({ nullable: true, type: String }) reviewReason!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ type: [RefundResponse] }) refunds?: RefundResponse[];
}

export class PaymentPage {
  @ApiProperty({ type: [PaymentResponse] }) items!: PaymentResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

const toRefund = (refund: RefundRecord): RefundResponse => ({
  id: refund.id,
  status: refund.status,
  amount: centsToPesos(refund.amountCents),
  reason: refund.reason,
  failureReason: refund.failureReason,
  providerReference: refund.providerReference,
  createdAt: refund.createdAt,
});

const toPayment = (payment: PaymentRecord, refunds?: RefundRecord[]): PaymentResponse => ({
  id: payment.id,
  orderId: payment.orderId,
  orderNumber: payment.orderNumber,
  provider: payment.provider,
  reference: payment.reference,
  transactionId: payment.providerReference,
  status: payment.status,
  amount: centsToPesos(payment.amountCents),
  currency: payment.currency,
  paymentMethodType: payment.paymentMethodType,
  reviewReason: payment.reviewReason,
  createdAt: payment.createdAt,
  ...(refunds ? { refunds: refunds.map(toRefund) } : {}),
});

const toDetail = ({ payment, refunds }: PaymentDetail) => toPayment(payment, refunds);

// ---------- Controladores ----------

@ApiTags('pagos')
@OptionalAuth()
@Controller('orders/:orderNumber/payments')
export class OrderPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Inicia el pago del pedido en la pasarela',
    description:
      'Devuelve la URL del Web Checkout y los parámetros del Widget con la firma de integridad. ' +
      'La pasarela devuelve al cliente a /pedido/:numero/pago?id=<transacción>.',
  })
  @ApiOkResponse({ type: StartPaymentResponse })
  async start(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Param('orderNumber') orderNumber: string,
    @Body() body: OrderAccessDto,
    @Headers('x-order-token') headerToken: string | undefined,
  ): Promise<StartPaymentResponse> {
    const started = await this.payments.start({
      orderNumber,
      userId: user?.id ?? null,
      token: headerToken ?? body.token ?? null,
    });
    return started.kind === 'free'
      ? { kind: 'free', order: toOrderResponse(started.order) }
      : {
          kind: 'checkout',
          reference: started.reference,
          checkoutUrl: started.session.checkoutUrl,
          widget: started.session.widget,
        };
  }

  @Post('confirm')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Al volver de la pasarela: consulta la transacción y actualiza el pedido',
    description: 'El estado se toma de la pasarela con la llave privada, nunca del navegador.',
  })
  @ApiOkResponse({ type: OrderResponse })
  async confirm(
    @MaybeCurrentUser() user: AuthenticatedUser | null,
    @Param('orderNumber') orderNumber: string,
    @Body() body: ConfirmPaymentDto,
    @Headers('x-order-token') headerToken: string | undefined,
  ): Promise<OrderResponse> {
    return toOrderResponse(
      await this.payments.confirmFromRedirect(
        { orderNumber, userId: user?.id ?? null, token: headerToken ?? body.token ?? null },
        body.transactionId,
      ),
    );
  }
}

@ApiTags('pagos')
@Public()
@SkipThrottle()
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('wompi')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Eventos de Wompi (configurar esta URL en el panel de Wompi)',
    description: 'Responde 200 cuando el evento quedó procesado; con otro estado Wompi reintenta.',
  })
  async wompi(
    @Body() body: unknown,
    @Headers('x-event-checksum') checksum: string | undefined,
  ): Promise<{ received: true }> {
    await this.payments.handleWebhook(body, { 'x-event-checksum': checksum });
    return { received: true };
  }
}

@ApiTags('admin: pagos')
@ApiBearerAuth()
@Controller('admin')
export class AdminPaymentsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get('payments')
  @RequirePermissions(PERMISSIONS.PAYMENTS_READ)
  @ApiOkResponse({ type: PaymentPage })
  async list(@Query() query: ListPaymentsQuery): Promise<PaymentPage> {
    const page = await this.refunds.list(query);
    return { ...page, items: page.items.map((payment) => toPayment(payment)) };
  }

  @Get('payments/:id')
  @RequirePermissions(PERMISSIONS.PAYMENTS_READ)
  @ApiOkResponse({ type: PaymentResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<PaymentResponse> {
    return toDetail(await this.refunds.detail(id));
  }

  @Post('payments/:id/refunds')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PAYMENTS_REFUND)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Repetir con la misma clave no duplica',
  })
  @ApiOperation({
    summary: 'Reembolso total o parcial por la pasarela',
    description: 'Si se devuelve todo, el pedido pasa a CANCELLED (o REFUNDED si ya se envió).',
  })
  @ApiOkResponse({ type: PaymentResponse })
  async refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: RefundDto,
    @Req() request: Request,
  ): Promise<PaymentResponse> {
    if (!idempotencyKey || !/^[\w-]{8,100}$/.test(idempotencyKey)) {
      throw new BadRequestException('Falta el encabezado Idempotency-Key (8 a 100 caracteres)');
    }
    return toDetail(
      await this.refunds.request(actorOf(user, request), id, {
        amountCents: body.amount === undefined ? null : pesosToCents(body.amount),
        reason: body.reason,
        restock: body.restock ?? false,
        idempotencyKey,
      }),
    );
  }

  @Patch('refunds/:id')
  @RequirePermissions(PERMISSIONS.PAYMENTS_REFUND)
  @ApiOperation({ summary: 'Confirma el resultado de un reembolso en curso o hecho por fuera' })
  @ApiOkResponse({ type: PaymentResponse })
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResolveRefundDto,
    @Req() request: Request,
  ): Promise<PaymentResponse> {
    return toDetail(
      await this.refunds.resolve(
        actorOf(user, request),
        id,
        body.status,
        body.restock ?? false,
        body.note ?? null,
      ),
    );
  }
}
