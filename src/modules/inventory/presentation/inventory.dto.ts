import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import type { StockFilter } from '../application/ports';
import { MAX_LOW_STOCK_THRESHOLD, MAX_STOCK_QUANTITY } from '../domain/stock';

const STOCK_FILTERS: StockFilter[] = ['available', 'low', 'out'];

export class ListInventoryQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Busca en SKU y nombre del producto' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ enum: STOCK_FILTERS, description: 'low = pocas unidades; out = agotado' })
  @IsOptional()
  @IsIn(STOCK_FILTERS)
  stock?: StockFilter;
}

export class ReceiveStockDto {
  @ApiProperty({ minimum: 1, example: 5 })
  @IsInt()
  @Min(1)
  @Max(MAX_STOCK_QUANTITY)
  quantity!: number;

  @ApiPropertyOptional({ example: 'Entrega del taller, lote de noviembre' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class CountStockDto {
  @ApiProperty({ minimum: 0, description: 'Existencias reales tras el conteo' })
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK_QUANTITY)
  quantityOnHand!: number;

  @ApiProperty({ example: 'Conteo mensual: una pieza con defecto' })
  @IsString()
  @MaxLength(300)
  reason!: string;
}

export class ThresholdDto {
  @ApiProperty({
    minimum: 0,
    description: 'Con estas unidades o menos se muestra "últimas unidades"',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_LOW_STOCK_THRESHOLD)
  lowStockThreshold!: number;
}

export class InventoryItemResponse {
  @ApiProperty() variantId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() variantName!: string;
  @ApiProperty() variantActive!: boolean;
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productStatus!: string;
  @ApiProperty() quantityOnHand!: number;
  @ApiProperty({ description: 'Apartadas en checkouts en curso' }) quantityReserved!: number;
  @ApiProperty() available!: number;
  @ApiProperty() lowStockThreshold!: number;
  @ApiProperty({ enum: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] }) availability!: string;
  @ApiProperty({ nullable: true, type: Date }) updatedAt!: Date | null;
}

export class InventoryPage {
  @ApiProperty({ type: [InventoryItemResponse] }) items!: InventoryItemResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class MovementResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['IN', 'OUT', 'RESERVE', 'RELEASE', 'ADJUSTMENT'] }) type!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() onHandAfter!: number;
  @ApiProperty() reservedAfter!: number;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty({ nullable: true, type: String }) referenceType!: string | null;
  @ApiProperty({ nullable: true, type: String }) referenceId!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class MovementPage {
  @ApiProperty({ type: [MovementResponse] }) items!: MovementResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
