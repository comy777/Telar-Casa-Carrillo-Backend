import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Page,
  type PageRequest,
  type RequestContext,
} from '../../../shared/application/audit-trail';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import { requirePositiveQuantity, requireStockCount, requireThreshold } from '../domain/stock';
import {
  INVENTORY_REPOSITORY,
  type InventoryItemView,
  type InventoryListQuery,
  type InventoryRepository,
  type MovementView,
} from './ports';

export interface InventoryActor {
  id: string;
  context: RequestContext;
}

const MAX_REASON_LENGTH = 300;

function cleanReason(reason: string | null | undefined): string | null {
  const text = reason?.trim();
  if (!text) return null;
  if (text.length > MAX_REASON_LENGTH) {
    throw new BusinessRuleViolation(
      `El motivo no puede superar ${MAX_REASON_LENGTH} caracteres`,
      'FIELD_TOO_LONG',
    );
  }
  return text;
}

/** Ingresos, conteos físicos y umbrales. Cada cambio deja movimiento y auditoría. */
@Injectable()
export class InventoryAdministration {
  constructor(
    @Inject(INVENTORY_REPOSITORY) private readonly inventory: InventoryRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  list(query: InventoryListQuery): Promise<Page<InventoryItemView>> {
    return this.inventory.list(query);
  }

  get(variantId: string): Promise<InventoryItemView> {
    return this.requireItem(variantId);
  }

  async movements(variantId: string, page: PageRequest): Promise<Page<MovementView>> {
    await this.requireVariant(variantId);
    return this.inventory.movements(variantId, page);
  }

  /** Entrada de mercancía (producción terminada, compra al artesano). */
  receive(
    actor: InventoryActor,
    variantId: string,
    quantity: number,
    reason?: string | null,
  ): Promise<InventoryItemView> {
    requirePositiveQuantity(quantity);
    const note = cleanReason(reason);
    return this.unitOfWork.execute(async () => {
      await this.requireVariant(variantId);
      const after = await this.inventory.receive(variantId, quantity);
      await this.inventory.recordMovement({
        variantId,
        type: 'IN',
        quantity,
        after,
        reason: note,
        referenceType: 'manual',
      });
      await this.record(actor, 'inventory.received', variantId, { quantity });
      return this.requireItem(variantId);
    });
  }

  /** Conteo físico: fija las existencias reales. No puede quedar por debajo de lo apartado. */
  count(
    actor: InventoryActor,
    variantId: string,
    quantityOnHand: number,
    reason: string,
  ): Promise<InventoryItemView> {
    requireStockCount(quantityOnHand);
    const note = cleanReason(reason);
    if (!note) {
      throw new BusinessRuleViolation('Indica el motivo del ajuste', 'REASON_REQUIRED');
    }
    return this.unitOfWork.execute(async () => {
      await this.requireVariant(variantId);
      const before = (await this.inventory.levels([variantId])).get(variantId);
      const previous = before?.quantityOnHand ?? 0;
      const after = await this.inventory.setOnHand(variantId, quantityOnHand);
      if (!after) {
        throw new BusinessRuleViolation(
          'Las existencias no pueden quedar por debajo de las unidades apartadas en checkouts',
          'STOCK_BELOW_RESERVED',
          { reserved: before?.quantityReserved ?? 0 },
        );
      }
      const difference = quantityOnHand - previous;
      if (difference !== 0) {
        await this.inventory.recordMovement({
          variantId,
          type: 'ADJUSTMENT',
          quantity: Math.abs(difference),
          after,
          reason: note,
          referenceType: 'manual',
        });
      }
      await this.record(actor, 'inventory.counted', variantId, {
        from: previous,
        to: quantityOnHand,
        reason: note,
      });
      return this.requireItem(variantId);
    });
  }

  setThreshold(
    actor: InventoryActor,
    variantId: string,
    threshold: number,
  ): Promise<InventoryItemView> {
    requireThreshold(threshold);
    return this.unitOfWork.execute(async () => {
      await this.requireVariant(variantId);
      await this.inventory.setThreshold(variantId, threshold);
      await this.record(actor, 'inventory.threshold_changed', variantId, { threshold });
      return this.requireItem(variantId);
    });
  }

  private async requireVariant(variantId: string): Promise<void> {
    if (!(await this.inventory.variantExists(variantId))) {
      throw new NotFoundError('Variante', variantId);
    }
  }

  private async requireItem(variantId: string): Promise<InventoryItemView> {
    const item = await this.inventory.findItem(variantId);
    if (!item) throw new NotFoundError('Variante', variantId);
    return item;
  }

  private record(
    actor: InventoryActor,
    action: string,
    variantId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      actorId: actor.id,
      action,
      resource: 'ProductVariant',
      resourceId: variantId,
      metadata,
      ipAddress: actor.context.ipAddress,
    });
  }
}
