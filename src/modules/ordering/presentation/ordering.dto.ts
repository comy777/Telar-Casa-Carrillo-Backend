import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDate,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  IDENTITY_DOCUMENT_TYPES,
  type IdentityDocumentType,
} from '../../../shared/domain/colombia';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import { centsToPesos } from '../../catalog/domain/money';
import { ToBoolean } from '../../catalog/presentation/validators';
import { AddressDto } from '../../shipping/presentation/shipping.dto';
import type { Quote } from '../application/checkout.service';
import type { OrderRecord } from '../application/ports';
import { ORDER_STATUSES, type OrderStatus } from '../domain/order-status';

// ---------- Peticiones ----------

export class QuoteDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  shippingMethodId?: string;

  @ApiPropertyOptional({ example: 'NAVIDAD10', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  couponCode?: string | null;

  @ApiPropertyOptional({ description: 'Invitados: para validar el límite por cliente del cupón' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class DocumentDto {
  @ApiProperty({ enum: IDENTITY_DOCUMENT_TYPES })
  @IsIn(IDENTITY_DOCUMENT_TYPES)
  type!: IdentityDocumentType;

  @ApiProperty({ example: '1020304050' })
  @IsString()
  @MaxLength(20)
  number!: string;
}

export class PlaceOrderDto {
  @ApiPropertyOptional({ description: 'Obligatorio sin sesión', example: 'ana@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiProperty({ example: 'Ana Pérez' })
  @IsString()
  @MaxLength(160)
  customerName!: string;

  @ApiProperty({ example: '+57 300 123 4567' })
  @IsString()
  @MaxLength(30)
  phone!: string;

  @ApiPropertyOptional({
    type: DocumentDto,
    description: 'Para la factura; sin él, consumidor final',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentDto)
  document?: DocumentDto;

  @ApiPropertyOptional({ format: 'uuid', description: 'Dirección guardada (con sesión)' })
  @IsOptional()
  @IsUUID()
  addressId?: string;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress?: AddressDto;

  @ApiPropertyOptional({ type: AddressDto, description: 'Si es distinta de la de envío' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  billingAddress?: AddressDto;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  shippingMethodId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  couponCode?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiProperty({ description: 'Términos, política de datos y condiciones de la venta a distancia' })
  @IsBoolean()
  @Equals(true, { message: 'Debes aceptar los términos' })
  acceptTerms!: boolean;
}

export class ListOrdersQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'Número, correo o nombre' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ type: Date })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: Date })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ description: 'Pagados sin factura registrada' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  invoicePending?: boolean;
}

export class ChangeOrderStatusDto {
  @ApiProperty({ enum: ['CANCELLED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] })
  @IsIn(['CANCELLED', 'PROCESSING', 'SHIPPED', 'DELIVERED'])
  status!: OrderStatus;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class RecordInvoiceDto {
  @ApiProperty({ example: 'FE-1024' })
  @IsString()
  @MaxLength(40)
  invoiceNumber!: string;

  @ApiPropertyOptional({ description: 'Código único de factura electrónica' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cufe?: string;
}

// ---------- Respuestas ----------

export class TotalsResponse {
  @ApiProperty({ description: 'Pesos, IVA incluido' }) subtotal!: number;
  @ApiProperty() discount!: number;
  @ApiProperty() shipping!: number;
  @ApiProperty({ description: 'IVA incluido en el total (informativo)' }) tax!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ example: 'COP' }) currency!: string;
}

export class QuoteResponse {
  @ApiProperty({ type: TotalsResponse }) totals!: TotalsResponse;
  @ApiProperty({ nullable: true, type: Object }) coupon!: { code: string; discount: number } | null;
  @ApiProperty({ nullable: true, type: Object }) shippingMethod!: {
    id: string;
    name: string;
  } | null;
  @ApiProperty() canCheckout!: boolean;
}

export const toQuoteResponse = (quote: Quote): QuoteResponse => ({
  totals: {
    subtotal: centsToPesos(quote.totals.subtotalCents),
    discount: centsToPesos(quote.totals.discountCents),
    shipping: centsToPesos(quote.totals.shippingCents),
    tax: centsToPesos(quote.totals.taxCents),
    total: centsToPesos(quote.totals.grandTotalCents),
    currency: 'COP',
  },
  coupon: quote.coupon
    ? { code: quote.coupon.code, discount: centsToPesos(quote.coupon.discountCents) }
    : null,
  shippingMethod: quote.shippingMethod,
  canCheckout: quote.cart.canCheckout,
});

export class OrderItemResponse {
  @ApiProperty() productName!: string;
  @ApiProperty({ nullable: true, type: String }) variantName!: string | null;
  @ApiProperty() sku!: string;
  @ApiProperty() unitPrice!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() discount!: number;
  @ApiProperty({ description: 'Con descuento, IVA incluido' }) total!: number;
  @ApiProperty() taxRate!: number;
  @ApiProperty() tax!: number;
  @ApiProperty({ nullable: true, type: String }) productSlug!: string | null;
  @ApiProperty({ nullable: true, type: Object }) image!: unknown;
}

export class OrderHistoryResponse {
  @ApiProperty({ enum: ORDER_STATUSES }) status!: OrderStatus;
  @ApiProperty() at!: Date;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
}

export class OrderResponse {
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: ORDER_STATUSES }) status!: OrderStatus;
  @ApiProperty({ type: TotalsResponse }) totals!: TotalsResponse;
  @ApiProperty({ type: [OrderItemResponse] }) items!: OrderItemResponse[];
  @ApiProperty() customerName!: string;
  @ApiProperty() customerEmail!: string;
  @ApiProperty({ type: Object }) shippingAddress!: unknown;
  @ApiProperty({ nullable: true, type: Object }) shippingMethod!: { name: string } | null;
  @ApiProperty({ nullable: true, type: String }) couponCode!: string | null;
  @ApiProperty({ nullable: true, type: Date, description: 'Plazo para pagar' })
  paymentDueAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) paidAt!: Date | null;
  @ApiProperty({ nullable: true, type: String }) invoiceNumber!: string | null;
  @ApiProperty({ type: [OrderHistoryResponse] }) history!: OrderHistoryResponse[];
  @ApiProperty() createdAt!: Date;
}

export class PlacedOrderResponse {
  @ApiProperty({ type: OrderResponse }) order!: OrderResponse;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Solo invitados: para consultar el pedido en GET /orders/:orderNumber?token=',
  })
  accessToken!: string | null;
}

export class AdminOrderResponse extends OrderResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) userId!: string | null;
  @ApiProperty({ nullable: true, type: String }) customerPhone!: string | null;
  @ApiProperty({ nullable: true, type: String }) customerDocumentType!: string | null;
  @ApiProperty({ nullable: true, type: String }) customerDocumentNumber!: string | null;
  @ApiProperty({ nullable: true, type: Object }) billingAddress!: unknown;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
  @ApiProperty({ nullable: true, type: String }) invoiceCufe!: string | null;
  @ApiProperty({ nullable: true, type: Date }) cancelledAt!: Date | null;
}

export class OrderPage {
  @ApiProperty({ type: [OrderResponse] }) items!: OrderResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class AdminOrderPage {
  @ApiProperty({ type: [AdminOrderResponse] }) items!: AdminOrderResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export function toOrderResponse(order: OrderRecord): OrderResponse {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    totals: {
      subtotal: centsToPesos(order.subtotalCents),
      discount: centsToPesos(order.discountTotalCents),
      shipping: centsToPesos(order.shippingTotalCents),
      tax: centsToPesos(order.taxTotalCents),
      total: centsToPesos(order.grandTotalCents),
      currency: order.currency,
    },
    items: order.items.map((item) => ({
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      unitPrice: centsToPesos(item.unitPriceCents),
      quantity: item.quantity,
      discount: centsToPesos(item.discountCents),
      total: centsToPesos(item.lineTotalCents),
      taxRate: item.taxRateBasisPoints / 10_000,
      tax: centsToPesos(item.taxCents),
      productSlug:
        typeof item.snapshot['productSlug'] === 'string' ? item.snapshot['productSlug'] : null,
      image: item.snapshot['image'] ?? null,
    })),
    customerName: order.customer.name,
    customerEmail: order.customer.email,
    shippingAddress: order.shippingAddress,
    shippingMethod: order.shippingMethod ? { name: order.shippingMethod.name } : null,
    couponCode: order.couponCode,
    paymentDueAt: order.status === 'PENDING_PAYMENT' ? order.paymentDueAt : null,
    paidAt: order.paidAt,
    invoiceNumber: order.invoice?.number ?? null,
    history: order.history.map((entry) => ({
      status: entry.to,
      at: entry.createdAt,
      note: entry.note,
    })),
    createdAt: order.createdAt,
  };
}

export function toAdminOrderResponse(order: OrderRecord): AdminOrderResponse {
  return {
    ...toOrderResponse(order),
    id: order.id,
    userId: order.userId,
    customerPhone: order.customer.phone,
    customerDocumentType: order.customer.documentType,
    customerDocumentNumber: order.customer.documentNumber,
    billingAddress: order.billingAddress,
    notes: order.notes,
    invoiceCufe: order.invoice?.cufe ?? null,
    cancelledAt: order.cancelledAt,
  };
}
