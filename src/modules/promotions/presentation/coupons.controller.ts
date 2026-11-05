import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { actorOf } from '../../../shared/presentation/actor';
import {
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from '../../../shared/presentation/auth.decorators';
import { PERMISSIONS } from '../../identity/domain/permissions';
import { CouponAdministration } from '../application/coupons.services';
import type { CouponInput, CouponProps, DiscountType } from '../domain/coupon';

const TYPES: DiscountType[] = ['PERCENTAGE', 'FIXED_AMOUNT'];
const toCents = (value: number) => Math.round(value * 100);

export class CouponDto {
  @ApiProperty({ example: 'NAVIDAD10', description: 'Se guarda en mayúsculas' })
  @IsString()
  @MaxLength(30)
  code!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiProperty({ enum: TYPES })
  @IsIn(TYPES)
  discountType!: DiscountType;

  @ApiProperty({
    example: 10,
    description: 'PERCENTAGE: porcentaje (10 = 10 %). FIXED_AMOUNT: pesos',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999)
  value!: number;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Subtotal mínimo en pesos' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumSubtotal?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Tope del descuento en pesos' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscount?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerLimit?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startsAt?: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCouponDto extends PartialType(CouponDto) {}

export class CouponResponse {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: TYPES }) discountType!: DiscountType;
  @ApiProperty() value!: number;
  @ApiProperty({ nullable: true, type: Number }) minimumSubtotal!: number | null;
  @ApiProperty({ nullable: true, type: Number }) maxDiscount!: number | null;
  @ApiProperty({ nullable: true, type: Number }) usageLimit!: number | null;
  @ApiProperty({ nullable: true, type: Number }) perCustomerLimit!: number | null;
  @ApiProperty({ nullable: true, type: Date }) startsAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) expiresAt!: Date | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ description: 'Pedidos que lo usan (los cancelados sin pagar no cuentan)' })
  usageCount!: number;
}

const toResponse = ({
  value,
  minimumSubtotalCents,
  maxDiscountCents,
  ...rest
}: CouponProps): CouponResponse => ({
  ...rest,
  value: value / 100,
  minimumSubtotal: minimumSubtotalCents === null ? null : minimumSubtotalCents / 100,
  maxDiscount: maxDiscountCents === null ? null : maxDiscountCents / 100,
});

/** Convierte solo los campos enviados; null vacía los opcionales. */
function toInput(dto: Partial<CouponDto>): Partial<CouponInput> {
  const input: Partial<CouponInput> = {};
  if (dto.code != null) input.code = dto.code;
  if (dto.description !== undefined) input.description = dto.description;
  if (dto.discountType != null) input.discountType = dto.discountType;
  if (dto.value != null) input.value = toCents(dto.value);
  if (dto.minimumSubtotal !== undefined) {
    input.minimumSubtotalCents = dto.minimumSubtotal === null ? null : toCents(dto.minimumSubtotal);
  }
  if (dto.maxDiscount !== undefined) {
    input.maxDiscountCents = dto.maxDiscount === null ? null : toCents(dto.maxDiscount);
  }
  if (dto.usageLimit !== undefined) input.usageLimit = dto.usageLimit;
  if (dto.perCustomerLimit !== undefined) input.perCustomerLimit = dto.perCustomerLimit;
  if (dto.startsAt !== undefined) input.startsAt = dto.startsAt;
  if (dto.expiresAt !== undefined) input.expiresAt = dto.expiresAt;
  if (dto.isActive != null) input.isActive = dto.isActive;
  return input;
}

@ApiTags('admin: promociones')
@ApiBearerAuth()
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly coupons: CouponAdministration) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOkResponse({ type: [CouponResponse] })
  async list(): Promise<CouponResponse[]> {
    return (await this.coupons.list()).map(toResponse);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOkResponse({ type: CouponResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CouponResponse> {
    return toResponse(await this.coupons.get(id));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOkResponse({ type: CouponResponse })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CouponDto,
    @Req() request: Request,
  ): Promise<CouponResponse> {
    const input = toInput(body);
    return toResponse(
      await this.coupons.create(actorOf(user, request), {
        code: body.code,
        discountType: body.discountType,
        value: toCents(body.value),
        description: input.description ?? null,
        minimumSubtotalCents: input.minimumSubtotalCents ?? null,
        maxDiscountCents: input.maxDiscountCents ?? null,
        usageLimit: input.usageLimit ?? null,
        perCustomerLimit: input.perCustomerLimit ?? null,
        startsAt: input.startsAt ?? null,
        expiresAt: input.expiresAt ?? null,
        isActive: input.isActive ?? true,
      }),
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE)
  @ApiOkResponse({ type: CouponResponse })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCouponDto,
    @Req() request: Request,
  ): Promise<CouponResponse> {
    return toResponse(await this.coupons.update(actorOf(user, request), id, toInput(body)));
  }
}
