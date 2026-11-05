import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../shared/application/actor';
import { AUDIT_TRAIL, type AuditTrail } from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import {
  type CouponInput,
  type CouponProps,
  discountFor,
  normalizeCouponCode,
  validateCoupon,
} from '../domain/coupon';

export interface CouponCustomer {
  email: string;
  userId: string | null;
}

export interface CouponRepository {
  list(): Promise<CouponProps[]>;
  findById(id: string): Promise<CouponProps | null>;
  findByCode(code: string): Promise<CouponProps | null>;
  /** SELECT ... FOR UPDATE: serializa los checkouts que usan el mismo cupón. */
  lockByCode(code: string): Promise<CouponProps | null>;
  /** Lanza ConflictError si el código ya existe. */
  save(coupon: CouponProps): Promise<void>;
  countRedemptions(
    couponId: string,
    customer: CouponCustomer,
  ): Promise<{ total: number; forCustomer: number }>;
  createRedemption(couponId: string, orderId: string, customer: CouponCustomer): Promise<void>;
  /** Borra el uso del pedido (si había) y devuelve el cupón afectado. */
  deleteRedemptionForOrder(orderId: string): Promise<string | null>;
  adjustUsageCount(couponId: string, delta: number): Promise<void>;
}
export const COUPON_REPOSITORY = Symbol('CouponRepository');

export interface AppliedCoupon {
  couponId: string;
  code: string;
  discountCents: number;
}

@Injectable()
export class CouponAdministration {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  list(): Promise<CouponProps[]> {
    return this.coupons.list();
  }

  async get(id: string): Promise<CouponProps> {
    const coupon = await this.coupons.findById(id);
    if (!coupon) throw new NotFoundError('Cupón', id);
    return coupon;
  }

  create(actor: Actor, input: CouponInput): Promise<CouponProps> {
    return this.unitOfWork.execute(async () => {
      const coupon: CouponProps = {
        id: crypto.randomUUID(),
        usageCount: 0,
        ...validateCoupon(input),
      };
      await this.coupons.save(coupon);
      await this.record(actor, 'coupon.created', coupon.id, { code: coupon.code });
      return coupon;
    });
  }

  update(actor: Actor, id: string, changes: Partial<CouponInput>): Promise<CouponProps> {
    return this.unitOfWork.execute(async () => {
      const current = await this.get(id);
      const { id: _id, usageCount, ...rest } = current;
      const coupon: CouponProps = { id, usageCount, ...validateCoupon({ ...rest, ...changes }) };
      await this.coupons.save(coupon);
      await this.record(actor, 'coupon.updated', id, { fields: Object.keys(changes) });
      return coupon;
    });
  }

  private record(actor: Actor, action: string, id: string, metadata: Record<string, unknown>) {
    return this.audit.record({
      actorId: actor.id,
      action,
      resource: 'Coupon',
      resourceId: id,
      metadata,
      ipAddress: actor.context.ipAddress,
    });
  }
}

/** API para el checkout: calcular, aplicar y anular usos de cupones. */
@Injectable()
export class CouponRedemptions {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Cálculo sin registrar el uso (cotización). */
  async preview(
    code: string,
    subtotalCents: number,
    customer: CouponCustomer,
  ): Promise<AppliedCoupon> {
    const coupon = await this.coupons.findByCode(normalizeCouponCode(code));
    return this.evaluate(coupon, subtotalCents, customer);
  }

  /**
   * Bloquea el cupón y calcula el descuento. Debe llamarse dentro de la
   * transacción que crea el pedido, seguida de `record` con el id del pedido:
   * el bloqueo dura hasta el commit, así los límites se respetan con compras simultáneas.
   */
  async lockAndEvaluate(
    code: string,
    subtotalCents: number,
    customer: CouponCustomer,
  ): Promise<AppliedCoupon> {
    const coupon = await this.coupons.lockByCode(normalizeCouponCode(code));
    return this.evaluate(coupon, subtotalCents, customer);
  }

  async record(applied: AppliedCoupon, orderId: string, customer: CouponCustomer): Promise<void> {
    await this.coupons.createRedemption(applied.couponId, orderId, customer);
    await this.coupons.adjustUsageCount(applied.couponId, 1);
  }

  /** Un pedido cancelado sin pagar devuelve el uso del cupón. */
  async cancelForOrder(orderId: string): Promise<void> {
    const couponId = await this.coupons.deleteRedemptionForOrder(orderId);
    if (couponId) await this.coupons.adjustUsageCount(couponId, -1);
  }

  private async evaluate(
    coupon: CouponProps | null,
    subtotalCents: number,
    customer: CouponCustomer,
  ): Promise<AppliedCoupon> {
    if (!coupon) throw new BusinessRuleViolation('El cupón no existe', 'COUPON_NOT_FOUND');
    const counts = await this.coupons.countRedemptions(coupon.id, customer);
    const discountCents = discountFor(coupon, subtotalCents, this.clock.now(), counts);
    return { couponId: coupon.id, code: coupon.code, discountCents };
  }
}
