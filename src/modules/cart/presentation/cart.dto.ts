import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { centsToPesos } from '../../catalog/domain/money';
import type { CartView } from '../application/cart.service';
import { MAX_QUANTITY_PER_LINE } from '../domain/cart';

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  variantId!: string;

  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1, maximum: MAX_QUANTITY_PER_LINE })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY_PER_LINE)
  quantity = 1;
}

export class SetCartItemDto {
  @ApiProperty({ minimum: 1, maximum: MAX_QUANTITY_PER_LINE })
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY_PER_LINE)
  quantity!: number;
}

export class CartImageResponse {
  @ApiProperty() url!: string;
  @ApiProperty({ nullable: true, type: String }) altText!: string | null;
}

export class CartReservationResponse {
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
}

export class CartIssueResponse {
  @ApiProperty({ enum: ['UNAVAILABLE', 'OUT_OF_STOCK', 'INSUFFICIENT_STOCK'] }) code!: string;
  @ApiPropertyOptional() available?: number;
}

export class CartProductResponse {
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productSlug!: string;
  @ApiProperty() variantName!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  attributes!: Record<string, string>;
  @ApiProperty({ description: 'Precio unitario actual en pesos, IVA incluido' }) unitPrice!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: CartImageResponse }) image!: CartImageResponse | null;
}

export class CartLineResponse {
  @ApiProperty() variantId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ nullable: true, type: CartProductResponse }) product!: CartProductResponse | null;
  @ApiProperty() lineTotal!: number;
  @ApiProperty({ enum: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] }) availability!: string;
  @ApiProperty({ description: 'Máximo que se puede pedir de esta línea' }) maxQuantity!: number;
  @ApiProperty({ type: [CartIssueResponse] }) issues!: CartIssueResponse[];
}

export class CartResponse {
  @ApiProperty({ nullable: true, type: String }) id!: string | null;
  @ApiProperty({ type: [CartLineResponse] }) lines!: CartLineResponse[];
  @ApiProperty() itemCount!: number;
  @ApiProperty({ description: 'Pesos, IVA incluido; solo líneas sin problemas' }) subtotal!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'true si se puede iniciar el checkout' }) canCheckout!: boolean;
  @ApiProperty({
    nullable: true,
    type: CartReservationResponse,
    description: 'Unidades apartadas para el checkout hasta expiresAt',
  })
  reservation!: CartReservationResponse | null;
}

export function toCartResponse(view: CartView): CartResponse {
  return {
    id: view.id,
    lines: view.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      product: line.product
        ? (({ priceCents, taxRateBasisPoints: _t, ...product }) => ({
            ...product,
            unitPrice: centsToPesos(priceCents),
          }))(line.product)
        : null,
      lineTotal: centsToPesos(line.lineTotalCents),
      availability: line.availability,
      maxQuantity: line.maxQuantity,
      issues: line.issues,
    })),
    itemCount: view.itemCount,
    subtotal: centsToPesos(view.subtotalCents),
    currency: view.currency,
    canCheckout: view.canCheckout,
    reservation: view.reservation,
  };
}
