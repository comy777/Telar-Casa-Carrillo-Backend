import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../../../shared/application/actor';
import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Page,
  type PageRequest,
} from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, ConflictError, NotFoundError } from '../../../shared/domain/errors';
import { StockReservations } from '../../inventory/application/stock-reservations.service';
import type { ShortLine } from '../../inventory/domain/stock';
import { CouponRedemptions } from '../../promotions/application/coupons.services';
import {
  assertManualTransition,
  assertTransition,
  isPaidStatus,
  type OrderStatus,
} from '../domain/order-status';
import {
  ELECTRONIC_INVOICE_ISSUER,
  type ElectronicInvoiceIssuer,
  ORDER_ACCESS_TOKENS,
  ORDER_REPOSITORY,
  type OrderAccessTokens,
  type OrderListQuery,
  type OrderRecord,
  type OrderRepository,
} from './ports';

/** Pedidos del cliente: con sesión por su cuenta, como invitado con el token del correo. */
@Injectable()
export class CustomerOrders {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(ORDER_ACCESS_TOKENS) private readonly tokens: OrderAccessTokens,
  ) {}

  list(userId: string, page: PageRequest): Promise<Page<OrderRecord>> {
    return this.orders.listForUser(userId, page);
  }

  async getForUser(userId: string, orderNumber: string): Promise<OrderRecord> {
    const order = await this.orders.findByNumber(orderNumber);
    // Mismo 404 si no existe o es de otro: no se revela qué números existen.
    if (order?.userId !== userId) throw new NotFoundError('Pedido');
    return order;
  }

  async getForGuest(orderNumber: string, token: string): Promise<OrderRecord> {
    const order = await this.orders.findByNumber(orderNumber);
    if (!order?.guestAccessTokenHash || !this.tokens.matches(token, order.guestAccessTokenHash)) {
      throw new NotFoundError('Pedido');
    }
    return order;
  }
}

export interface PaidResult {
  order: OrderRecord;
  /** Líneas sin stock (el pago llegó cuando ya no había unidades): revisar y reembolsar. */
  shortages: ShortLine[];
  /** El pedido ya estaba pagado (notificación repetida). */
  alreadyPaid: boolean;
}

/**
 * Ciclo de vida del pedido que disparan otros módulos (pagos) y los procesos
 * programados. Cada operación es idempotente.
 */
@Injectable()
export class OrderLifecycle {
  private readonly logger = new Logger(OrderLifecycle.name);

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(ELECTRONIC_INVOICE_ISSUER) private readonly invoices: ElectronicInvoiceIssuer,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly stock: StockReservations,
    private readonly coupons: CouponRedemptions,
  ) {}

  async require(id: string): Promise<OrderRecord> {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundError('Pedido', id);
    return order;
  }

  /**
   * Pago confirmado por la pasarela: PENDING_PAYMENT → PAID y las unidades
   * salen del inventario. Debe llamarse dentro de la transacción del pago.
   */
  async markPaid(orderId: string, note: string): Promise<PaidResult> {
    const order = await this.require(orderId);
    if (isPaidStatus(order.status)) return { order, shortages: [], alreadyPaid: true };
    if (order.status !== 'PENDING_PAYMENT') {
      // Llegó un pago aprobado para un pedido cancelado (p. ej. venció): se reembolsa.
      throw new BusinessRuleViolation(
        `El pedido ${order.orderNumber} está ${order.status}`,
        'ORDER_NOT_PAYABLE',
        { status: order.status },
      );
    }
    const now = this.clock.now();
    if (
      !(await this.orders.transition(orderId, {
        from: 'PENDING_PAYMENT',
        to: 'PAID',
        actorId: null,
        note,
        at: now,
      }))
    ) {
      return { order: await this.require(orderId), shortages: [], alreadyPaid: true };
    }
    const shortages = await this.stock.consumeForOrder(
      orderId,
      order.items
        .filter((item) => item.variantId)
        .map((item) => ({ variantId: item.variantId!, quantity: item.quantity })),
    );
    if (shortages.length > 0) {
      await this.audit.record({
        actorId: null,
        action: 'order.stock_shortage',
        resource: 'Order',
        resourceId: orderId,
        metadata: { shortages },
      });
    }
    return { order: await this.require(orderId), shortages, alreadyPaid: false };
  }

  /**
   * Emite la factura electrónica de un pedido pagado. Si no hay proveedor o
   * falla, queda pendiente para registrarla a mano; nunca bloquea el pago.
   */
  async issueInvoice(orderId: string): Promise<void> {
    const order = await this.require(orderId);
    if (order.invoice || !isPaidStatus(order.status)) return;
    try {
      const issued = await this.invoices.issue(order);
      if (issued) await this.orders.setInvoice(orderId, issued);
    } catch (error) {
      this.logger.error(`No se pudo emitir la factura de ${order.orderNumber}`, error);
    }
  }

  /** Cancela un pedido sin pagar: devuelve el stock y el uso del cupón. */
  cancelUnpaid(
    orderId: string,
    reason: 'order_cancelled' | 'order_expired',
    actorId: string | null,
    note?: string | null,
  ): Promise<boolean> {
    return this.unitOfWork.execute(async () => {
      const changed = await this.orders.transition(orderId, {
        from: 'PENDING_PAYMENT',
        to: 'CANCELLED',
        actorId,
        note: note ?? (reason === 'order_expired' ? 'Venció el plazo de pago' : null),
        at: this.clock.now(),
      });
      if (!changed) return false;
      await this.stock.releaseForOrder(orderId, reason);
      await this.coupons.cancelForOrder(orderId);
      return true;
    });
  }

  /**
   * Pedido pagado que se cancela o devuelve con reembolso total: cambia el
   * estado y, si las unidades no salieron del taller, vuelven al inventario.
   */
  closeWithRefund(
    orderId: string,
    actorId: string | null,
    note: string,
    restock: boolean,
  ): Promise<OrderRecord> {
    return this.unitOfWork.execute(async () => {
      const order = await this.require(orderId);
      const to: OrderStatus =
        order.status === 'SHIPPED' || order.status === 'DELIVERED' ? 'REFUNDED' : 'CANCELLED';
      assertTransition(order.status, to);
      const changed = await this.orders.transition(orderId, {
        from: order.status,
        to,
        actorId,
        note,
        at: this.clock.now(),
      });
      if (!changed)
        throw new ConflictError('El pedido cambió mientras se procesaba', 'ORDER_CHANGED');
      if (restock) {
        await this.stock.restockForOrder(
          orderId,
          order.items
            .filter((item) => item.variantId)
            .map((item) => ({ variantId: item.variantId!, quantity: item.quantity })),
          to === 'REFUNDED' ? 'return' : 'order_cancelled',
        );
      }
      return this.require(orderId);
    });
  }

  /** Proceso programado: cancela los pedidos cuyo plazo de pago venció. */
  async expireOverdue(
    isAwaitingPayment: (orderId: string) => Promise<boolean>,
    limit = 100,
  ): Promise<number> {
    const ids = await this.orders.findOverdueUnpaid(this.clock.now(), limit);
    let expired = 0;
    for (const id of ids) {
      // Un pago en curso (p. ej. PSE) se espera: la conciliación lo resolverá.
      if (await isAwaitingPayment(id)) continue;
      if (await this.cancelUnpaid(id, 'order_expired', null)) expired += 1;
    }
    return expired;
  }
}

/** Administración de pedidos: consulta, cambios de estado manuales y factura. */
@Injectable()
export class OrderAdministration {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly lifecycle: OrderLifecycle,
  ) {}

  list(query: OrderListQuery): Promise<Page<OrderRecord>> {
    return this.orders.list(query);
  }

  get(id: string): Promise<OrderRecord> {
    return this.lifecycle.require(id);
  }

  async changeStatus(
    actor: Actor,
    id: string,
    to: OrderStatus,
    note?: string | null,
  ): Promise<OrderRecord> {
    const order = await this.lifecycle.require(id);
    assertManualTransition(order.status, to);
    if (to === 'CANCELLED') {
      await this.lifecycle.cancelUnpaid(id, 'order_cancelled', actor.id, note);
    } else {
      const changed = await this.orders.transition(id, {
        from: order.status,
        to,
        actorId: actor.id,
        note,
        at: this.clock.now(),
      });
      if (!changed)
        throw new ConflictError('El pedido cambió mientras se procesaba', 'ORDER_CHANGED');
    }
    await this.audit.record({
      actorId: actor.id,
      action: 'order.status_changed',
      resource: 'Order',
      resourceId: id,
      metadata: { from: order.status, to, note: note ?? null },
      ipAddress: actor.context.ipAddress,
    });
    return this.lifecycle.require(id);
  }

  /** Factura emitida fuera del sistema (portal DIAN o proveedor sin integración). */
  recordInvoice(
    actor: Actor,
    id: string,
    number: string,
    cufe: string | null,
  ): Promise<OrderRecord> {
    return this.unitOfWork.execute(async () => {
      const order = await this.lifecycle.require(id);
      if (!isPaidStatus(order.status) && order.status !== 'REFUNDED') {
        throw new BusinessRuleViolation('Solo se facturan pedidos pagados', 'ORDER_NOT_PAID');
      }
      if (order.invoice) {
        throw new BusinessRuleViolation('El pedido ya tiene factura', 'ALREADY_INVOICED');
      }
      const invoiceNumber = number.trim();
      if (!invoiceNumber || invoiceNumber.length > 40) {
        throw new BusinessRuleViolation('Número de factura inválido', 'INVALID_INVOICE');
      }
      await this.orders.setInvoice(id, {
        number: invoiceNumber,
        cufe: cufe?.trim() || null,
        issuedAt: this.clock.now(),
      });
      await this.audit.record({
        actorId: actor.id,
        action: 'order.invoice_recorded',
        resource: 'Order',
        resourceId: id,
        metadata: { invoiceNumber },
        ipAddress: actor.context.ipAddress,
      });
      return this.lifecycle.require(id);
    });
  }
}
