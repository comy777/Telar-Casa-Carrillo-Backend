import { Module } from '@nestjs/common';
import {
  COUPON_REPOSITORY,
  CouponAdministration,
  CouponRedemptions,
} from './application/coupons.services';
import { PrismaCouponRepository } from './infrastructure/prisma-coupon.repository';
import { AdminCouponsController } from './presentation/coupons.controller';

@Module({
  controllers: [AdminCouponsController],
  providers: [
    { provide: COUPON_REPOSITORY, useClass: PrismaCouponRepository },
    CouponAdministration,
    CouponRedemptions,
  ],
  exports: [CouponRedemptions],
})
export class PromotionsModule {}
