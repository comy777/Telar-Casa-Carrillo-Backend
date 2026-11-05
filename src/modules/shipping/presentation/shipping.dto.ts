import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { centsToPesos } from '../../catalog/domain/money';
import type { SavedAddress } from '../domain/address';
import type { ShippingMethodProps } from '../domain/shipping-method';

/** Dirección en Colombia; el departamento se deduce del código DANE. */
export class AddressDto {
  @ApiProperty({ example: 'Ana Pérez' })
  @IsString()
  @MaxLength(120)
  recipient!: string;

  @ApiProperty({ example: '+57 300 123 4567' })
  @IsString()
  @MaxLength(30)
  phone!: string;

  @ApiProperty({ example: 'Calle 10 # 5-23' })
  @IsString()
  @MaxLength(200)
  line1!: string;

  @ApiPropertyOptional({ example: 'Apto 301', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string | null;

  @ApiProperty({ example: 'Riohacha' })
  @IsString()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: '44001', description: 'Código DANE del municipio (5 dígitos)' })
  @Matches(/^\d{5}$/, { message: 'cityDaneCode debe tener 5 dígitos' })
  cityDaneCode!: string;

  @ApiPropertyOptional({ example: '440001', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string | null;
}

export class SavedAddressDto extends AddressDto {
  @ApiPropertyOptional({ example: 'Casa', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string | null;

  @ApiPropertyOptional({ description: 'true la vuelve la dirección predeterminada' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class AddressResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) label!: string | null;
  @ApiProperty() recipient!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() line1!: string;
  @ApiProperty({ nullable: true, type: String }) line2!: string | null;
  @ApiProperty() city!: string;
  @ApiProperty() department!: string;
  @ApiProperty() cityDaneCode!: string;
  @ApiProperty({ nullable: true, type: String }) postalCode!: string | null;
  @ApiProperty() countryCode!: string;
  @ApiProperty() isDefault!: boolean;
}

export const toAddressResponse = ({ userId: _u, ...address }: SavedAddress): AddressResponse =>
  address;

export class ShippingMethodDto {
  @ApiProperty({ example: 'Envío nacional' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({ example: 15000, description: 'Pesos, IVA incluido' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  basePrice!: number;

  @ApiPropertyOptional({ example: 300000, nullable: true, type: Number })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999)
  freeShippingThreshold?: number | null;

  @ApiPropertyOptional({ example: '3 a 5 días hábiles', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  estimatedDelivery?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdateShippingMethodDto extends PartialType(ShippingMethodDto) {}

export class ShippingMethodResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() basePrice!: number;
  @ApiProperty({ nullable: true, type: Number }) freeShippingThreshold!: number | null;
  @ApiProperty({ nullable: true, type: String }) estimatedDelivery!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
}

export const toShippingMethodResponse = ({
  basePriceCents,
  freeShippingThresholdCents,
  ...rest
}: ShippingMethodProps): ShippingMethodResponse => ({
  ...rest,
  basePrice: centsToPesos(basePriceCents),
  freeShippingThreshold:
    freeShippingThresholdCents === null ? null : centsToPesos(freeShippingThresholdCents),
});
