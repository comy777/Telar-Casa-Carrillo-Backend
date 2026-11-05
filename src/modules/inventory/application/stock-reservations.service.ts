import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import {
  type Availability,
  availabilityOf,
  availableQuantity,
} from '../../../shared/domain/stock-availability';
import {
  insufficientStock,
  normalizeReservationLines,
  type ReleaseReason,
  type ReservationLine,
  type ShortLine,
} from '../domain/stock';
import {
  INVENTORY_REPOSITORY,
  INVENTORY_SETTINGS,
  type InventoryRepository,
  type InventorySettings,
  RESERVATION_REPOSITORY,
  type ReservationRecord,
  type ReservationRepository,
} from './ports';

export interface VariantAvailability {
  /** Unidades que este carrito puede comprar (incluye lo que ya tiene apartado). */
  available: number;
  availability: Availability;
}

export interface CartReservation {
  expiresAt: Date;
  lines: ReservationLine[];
}

/**
 * API pública del módulo de inventario para otros módulos (carrito, checkout).
 * Reservar aparta unidades durante el checkout; nunca al agregar al carrito.
 */
@Injectable()
export class StockReservations {
  constructor(
    @Inject(INVENTORY_REPOSITORY) private readonly inventory: InventoryRepository,
    @Inject(RESERVATION_REPOSITORY) private readonly reservations: ReservationRepository,
    @Inject(INVENTORY_SETTINGS) private readonly settings: InventorySettings,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Disponibilidad por variante; lo que el carrito ya tiene apartado cuenta como suyo. */
  async availableFor(
    variantIds: string[],
    cartId: string | null,
  ): Promise<Map<string, VariantAvailability>> {
    const [levels, own] = await Promise.all([
      this.inventory.levels(variantIds),
      cartId ? this.reservations.activeForCart(cartId) : Promise.resolve([]),
    ]);
    const result = new Map<string, VariantAvailability>();
    for (const variantId of variantIds) {
      const level = levels.get(variantId);
      const reservedByCart = own
        .filter((r) => r.variantId === variantId)
        .reduce((sum, r) => sum + r.quantity, 0);
      const available = availableQuantity(level) + reservedByCart;
      result.set(variantId, {
        available,
        availability: availabilityOf(available, level?.lowStockThreshold ?? 0),
      });
    }
    return result;
  }

  async activeForCart(cartId: string): Promise<CartReservation | null> {
    const active = await this.reservations.activeForCart(cartId);
    if (active.length === 0) return null;
    return {
      expiresAt: new Date(Math.min(...active.map((r) => r.expiresAt.getTime()))),
      lines: normalizeReservationLines(active),
    };
  }

  /**
   * Aparta todas las líneas o ninguna. Si el carrito ya tenía una reserva, la
   * reemplaza (y renueva el vencimiento). Lanza INSUFFICIENT_STOCK con el
   * detalle de cada línea que no alcanza.
   */
  reserveForCart(cartId: string, lines: ReservationLine[]): Promise<CartReservation> {
    const normalized = normalizeReservationLines(lines);
    return this.unitOfWork.execute(async () => {
      await this.releaseForCart(cartId, 'checkout_cancelled');

      const now = this.clock.now();
      const expiresAt = new Date(now.getTime() + this.settings.reservationMinutes * 60_000);
      const short: ShortLine[] = [];
      for (const line of normalized) {
        const after = await this.inventory.tryReserve(line.variantId, line.quantity);
        if (!after) {
          short.push({ variantId: line.variantId, requested: line.quantity, available: 0 });
          continue;
        }
        const id = crypto.randomUUID();
        await this.reservations.create({ id, cartId, ...line, expiresAt });
        await this.inventory.recordMovement({
          variantId: line.variantId,
          type: 'RESERVE',
          quantity: line.quantity,
          after,
          referenceType: 'cart',
          referenceId: cartId,
        });
      }
      if (short.length > 0) {
        // Se informa lo disponible real; la transacción se revierte al lanzar.
        const levels = await this.inventory.levels(short.map((line) => line.variantId));
        throw insufficientStock(
          short.map((line) => ({
            variantId: line.variantId,
            requested: line.requested,
            available: availableQuantity(levels.get(line.variantId)),
          })),
        );
      }
      return { expiresAt, lines: normalized };
    });
  }

  /** Devuelve al stock lo apartado por el carrito. Devuelve cuántas reservas liberó. */
  releaseForCart(cartId: string, reason: ReleaseReason): Promise<number> {
    return this.unitOfWork.execute(async () => {
      let released = 0;
      for (const reservation of await this.reservations.activeForCart(cartId)) {
        if (await this.release(reservation, reason)) released += 1;
      }
      return released;
    });
  }

  /**
   * Libera las reservas vencidas, cada una en su propia transacción para que un
   * fallo no detenga al resto. Seguro con varias instancias a la vez.
   */
  async releaseExpired(limit = 200): Promise<number> {
    const expired = await this.reservations.findExpired(this.clock.now(), limit);
    let released = 0;
    for (const reservation of expired) {
      const done = await this.unitOfWork.execute(() => this.release(reservation, 'expired'));
      if (done) released += 1;
    }
    return released;
  }

  private async release(reservation: ReservationRecord, reason: ReleaseReason): Promise<boolean> {
    if (!(await this.reservations.markReleased(reservation.id, this.clock.now()))) return false;
    const after = await this.inventory.releaseReserved(reservation.variantId, reservation.quantity);
    await this.inventory.recordMovement({
      variantId: reservation.variantId,
      type: 'RELEASE',
      quantity: reservation.quantity,
      after,
      reason,
      referenceType: 'reservation',
      referenceId: reservation.id,
    });
    return true;
  }
}
