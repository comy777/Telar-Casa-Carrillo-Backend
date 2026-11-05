import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError } from '../../../shared/domain/errors';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import { uniqueViolationFields } from '../../../shared/infrastructure/prisma/prisma-errors';
import type { CouponCustomer, CouponRepository } from '../application/coupons.services';
import type { CouponProps } from '../domain/coupon';

const cents = (value: Prisma.Decimal): number => Math.round(value.mul(100).toNumber());
const decimal = (value: number): Prisma.Decimal => new Prisma.Decimal(value).div(100);

type CouponRow = Prisma.CouponGetPayload<object>;

// En la base, value es el porcentaje (10.00) o el monto en pesos; en ambos casos ×100.
const toCoupon = (row: CouponRow): CouponProps => ({
  id: row.id,
  code: row.code,
  description: row.description,
  discountType: row.discountType,
  value: cents(row.value),
  minimumSubtotalCents: row.minimumSubtotal ? cents(row.minimumSubtotal) : null,
  maxDiscountCents: row.maxDiscount ? cents(row.maxDiscount) : null,
  usageLimit: row.usageLimit,
  perCustomerLimit: row.perCustomerLimit,
  startsAt: row.startsAt,
  expiresAt: row.expiresAt,
  isActive: row.isActive,
  usageCount: row.usageCount,
});

const customerWhere = (customer: CouponCustomer): Prisma.CouponRedemptionWhereInput => ({
  OR: [
    { customerEmail: customer.email },
    ...(customer.userId ? [{ userId: customer.userId }] : []),
  ],
});

@Injectable()
export class PrismaCouponRepository implements CouponRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async list(): Promise<CouponProps[]> {
    const rows = await this.db.client.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toCoupon);
  }

  async findById(id: string): Promise<CouponProps | null> {
    const row = await this.db.client.coupon.findUnique({ where: { id } });
    return row ? toCoupon(row) : null;
  }

  async findByCode(code: string): Promise<CouponProps | null> {
    const row = await this.db.client.coupon.findUnique({ where: { code } });
    return row ? toCoupon(row) : null;
  }

  async lockByCode(code: string): Promise<CouponProps | null> {
    const rows = await this.db.client.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Coupon" WHERE "code" = ${code} FOR UPDATE`;
    return rows[0] ? this.findById(rows[0].id) : null;
  }

  async save(coupon: CouponProps): Promise<void> {
    const { id, value, minimumSubtotalCents, maxDiscountCents, usageCount: _u, ...rest } = coupon;
    const fields = {
      ...rest,
      value: decimal(value),
      minimumSubtotal: minimumSubtotalCents === null ? null : decimal(minimumSubtotalCents),
      maxDiscount: maxDiscountCents === null ? null : decimal(maxDiscountCents),
    };
    try {
      await this.db.client.coupon.upsert({
        where: { id },
        create: { id, ...fields },
        update: fields,
      });
    } catch (error) {
      if (uniqueViolationFields(error)?.includes('code')) {
        throw new ConflictError('Ya existe un cupón con ese código', 'COUPON_CODE_TAKEN');
      }
      throw error;
    }
  }

  async countRedemptions(couponId: string, customer: CouponCustomer) {
    const [total, forCustomer] = await Promise.all([
      this.db.client.couponRedemption.count({ where: { couponId } }),
      this.db.client.couponRedemption.count({ where: { couponId, ...customerWhere(customer) } }),
    ]);
    return { total, forCustomer };
  }

  async createRedemption(couponId: string, orderId: string, customer: CouponCustomer) {
    await this.db.client.couponRedemption.create({
      data: { couponId, orderId, userId: customer.userId, customerEmail: customer.email },
    });
  }

  async deleteRedemptionForOrder(orderId: string): Promise<string | null> {
    const rows = await this.db.client.$queryRaw<{ couponId: string }[]>`
      DELETE FROM "CouponRedemption" WHERE "orderId" = ${orderId}::uuid RETURNING "couponId"`;
    return rows[0]?.couponId ?? null;
  }

  async adjustUsageCount(couponId: string, delta: number): Promise<void> {
    await this.db.client.coupon.update({
      where: { id: couponId },
      data: { usageCount: { increment: delta } },
    });
  }
}
