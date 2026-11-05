import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Page, PageRequest } from '../../../shared/application/audit-trail';
import { availabilityOf, availableQuantity } from '../../../shared/domain/stock-availability';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type {
  InventoryItemView,
  InventoryListQuery,
  InventoryRepository,
  MovementView,
  NewMovement,
  ReservationRecord,
  ReservationRepository,
  StockRecord,
} from '../application/ports';

/** Columnas devueltas por las actualizaciones atómicas. */
const RETURNING = Prisma.sql`RETURNING "variantId", "quantityOnHand", "quantityReserved", "lowStockThreshold"`;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

interface ItemRow {
  variantId: string;
  sku: string;
  variantName: string;
  variantActive: boolean;
  productId: string;
  productName: string;
  productStatus: string;
  quantityOnHand: number;
  quantityReserved: number;
  lowStockThreshold: number;
  updatedAt: Date | null;
}

const toItem = (row: ItemRow): InventoryItemView => {
  const available = availableQuantity(row);
  return { ...row, available, availability: availabilityOf(available, row.lowStockThreshold) };
};

@Injectable()
export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async levels(variantIds: string[]): Promise<Map<string, StockRecord>> {
    if (variantIds.length === 0) return new Map();
    const rows = await this.db.client.inventory.findMany({
      where: { variantId: { in: variantIds } },
      select: {
        variantId: true,
        quantityOnHand: true,
        quantityReserved: true,
        lowStockThreshold: true,
      },
    });
    return new Map(rows.map((row) => [row.variantId, row]));
  }

  async variantExists(variantId: string): Promise<boolean> {
    return (await this.db.client.productVariant.count({ where: { id: variantId } })) > 0;
  }

  async receive(variantId: string, quantity: number): Promise<StockRecord> {
    // El id lo genera Prisma en el cliente, por eso aquí se usa gen_random_uuid().
    const [row] = await this.db.client.$queryRaw<StockRecord[]>`
      INSERT INTO "Inventory" ("id", "variantId", "quantityOnHand", "updatedAt")
      VALUES (gen_random_uuid(), ${variantId}::uuid, ${quantity}, now())
      ON CONFLICT ("variantId") DO UPDATE
        SET "quantityOnHand" = "Inventory"."quantityOnHand" + EXCLUDED."quantityOnHand",
            "updatedAt" = now()
      ${RETURNING}`;
    return row!;
  }

  async setOnHand(variantId: string, quantityOnHand: number): Promise<StockRecord | null> {
    await this.ensureRow(variantId);
    const [row] = await this.db.client.$queryRaw<StockRecord[]>`
      UPDATE "Inventory" SET "quantityOnHand" = ${quantityOnHand}, "updatedAt" = now()
      WHERE "variantId" = ${variantId}::uuid AND "quantityReserved" <= ${quantityOnHand}
      ${RETURNING}`;
    return row ?? null;
  }

  async setThreshold(variantId: string, threshold: number): Promise<StockRecord> {
    await this.ensureRow(variantId);
    const [row] = await this.db.client.$queryRaw<StockRecord[]>`
      UPDATE "Inventory" SET "lowStockThreshold" = ${threshold}, "updatedAt" = now()
      WHERE "variantId" = ${variantId}::uuid
      ${RETURNING}`;
    return row!;
  }

  /**
   * La condición va en el mismo UPDATE: PostgreSQL bloquea la fila y vuelve a
   * evaluar el WHERE con el valor más reciente, así dos reservas simultáneas
   * de la última unidad no pueden tener éxito ambas.
   */
  async tryReserve(variantId: string, quantity: number): Promise<StockRecord | null> {
    const [row] = await this.db.client.$queryRaw<StockRecord[]>`
      UPDATE "Inventory"
      SET "quantityReserved" = "quantityReserved" + ${quantity}, "updatedAt" = now()
      WHERE "variantId" = ${variantId}::uuid
        AND "quantityOnHand" - "quantityReserved" >= ${quantity}
      ${RETURNING}`;
    return row ?? null;
  }

  async releaseReserved(variantId: string, quantity: number): Promise<StockRecord> {
    // Si el saldo quedara negativo, la restricción CHECK lo rechaza (sería un error de lógica).
    const [row] = await this.db.client.$queryRaw<StockRecord[]>`
      UPDATE "Inventory"
      SET "quantityReserved" = "quantityReserved" - ${quantity}, "updatedAt" = now()
      WHERE "variantId" = ${variantId}::uuid
      ${RETURNING}`;
    if (!row) throw new Error(`No hay inventario para la variante ${variantId}`);
    return row;
  }

  async consume(variantId: string, quantity: number): Promise<StockRecord> {
    const [row] = await this.db.client.$queryRaw<StockRecord[]>`
      UPDATE "Inventory"
      SET "quantityOnHand" = "quantityOnHand" - ${quantity},
          "quantityReserved" = "quantityReserved" - ${quantity},
          "updatedAt" = now()
      WHERE "variantId" = ${variantId}::uuid
      ${RETURNING}`;
    if (!row) throw new Error(`No hay inventario para la variante ${variantId}`);
    return row;
  }

  async recordMovement(movement: NewMovement): Promise<void> {
    await this.db.client.inventoryMovement.create({
      data: {
        variantId: movement.variantId,
        type: movement.type,
        quantity: movement.quantity,
        onHandAfter: movement.after.quantityOnHand,
        reservedAfter: movement.after.quantityReserved,
        reason: movement.reason ?? null,
        referenceType: movement.referenceType ?? null,
        referenceId: movement.referenceId ?? null,
      },
    });
  }

  async movements(variantId: string, page: PageRequest): Promise<Page<MovementView>> {
    const where = { variantId };
    const [rows, total] = await Promise.all([
      this.db.client.inventoryMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
        select: {
          id: true,
          type: true,
          quantity: true,
          onHandAfter: true,
          reservedAfter: true,
          reason: true,
          referenceType: true,
          referenceId: true,
          createdAt: true,
        },
      }),
      this.db.client.inventoryMovement.count({ where }),
    ]);
    return { items: rows, total, page: page.page, pageSize: page.pageSize };
  }

  async list(query: InventoryListQuery): Promise<Page<InventoryItemView>> {
    const conditions = this.conditions(query);
    const [countRows, rows] = await Promise.all([
      this.db.client.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS "total" ${this.from(conditions)}`,
      this.db.client.$queryRaw<ItemRow[]>`
        ${this.select()} ${this.from(conditions)}
        ORDER BY p."name", v."name", v."id"
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ]);
    return {
      items: rows.map(toItem),
      total: countRows[0]?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async findItem(variantId: string): Promise<InventoryItemView | null> {
    const [row] = await this.db.client.$queryRaw<ItemRow[]>`
      ${this.select()} ${this.from([Prisma.sql`v."id" = ${variantId}::uuid`])}`;
    return row ? toItem(row) : null;
  }

  private async ensureRow(variantId: string): Promise<void> {
    await this.db.client.$executeRaw`
      INSERT INTO "Inventory" ("id", "variantId", "updatedAt")
      VALUES (gen_random_uuid(), ${variantId}::uuid, now())
      ON CONFLICT ("variantId") DO NOTHING`;
  }

  // Variantes sin fila de inventario: 0 unidades y el umbral por defecto (3).
  private select(): Prisma.Sql {
    return Prisma.sql`
      SELECT v."id" AS "variantId", v."sku", v."name" AS "variantName", v."isActive" AS "variantActive",
        p."id" AS "productId", p."name" AS "productName", p."status"::text AS "productStatus",
        coalesce(i."quantityOnHand", 0) AS "quantityOnHand",
        coalesce(i."quantityReserved", 0) AS "quantityReserved",
        coalesce(i."lowStockThreshold", 3) AS "lowStockThreshold",
        i."updatedAt"`;
  }

  private from(conditions: Prisma.Sql[]): Prisma.Sql {
    return Prisma.sql`
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      LEFT JOIN "Inventory" i ON i."variantId" = v."id"
      ${conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}`;
  }

  private conditions(query: InventoryListQuery): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];
    const search = query.search?.trim();
    if (search) {
      const like = `%${escapeLike(search)}%`;
      conditions.push(Prisma.sql`(v."sku" ILIKE ${like} OR p."name" ILIKE ${like})`);
    }
    if (query.productId) conditions.push(Prisma.sql`p."id" = ${query.productId}::uuid`);
    const available = Prisma.sql`(coalesce(i."quantityOnHand", 0) - coalesce(i."quantityReserved", 0))`;
    if (query.stock === 'out') conditions.push(Prisma.sql`${available} <= 0`);
    if (query.stock === 'available') conditions.push(Prisma.sql`${available} > 0`);
    if (query.stock === 'low') {
      conditions.push(
        Prisma.sql`${available} > 0 AND ${available} <= coalesce(i."lowStockThreshold", 3)`,
      );
    }
    return conditions;
  }
}

@Injectable()
export class PrismaReservationRepository implements ReservationRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async create(reservation: ReservationRecord & { cartId: string }): Promise<void> {
    await this.db.client.stockReservation.create({
      data: {
        id: reservation.id,
        variantId: reservation.variantId,
        cartId: reservation.cartId,
        quantity: reservation.quantity,
        expiresAt: reservation.expiresAt,
      },
    });
  }

  activeForCart(cartId: string): Promise<ReservationRecord[]> {
    return this.db.client.stockReservation.findMany({
      where: { cartId, releasedAt: null },
      select: { id: true, variantId: true, cartId: true, quantity: true, expiresAt: true },
      orderBy: { variantId: 'asc' },
    });
  }

  activeForOrder(orderId: string): Promise<ReservationRecord[]> {
    return this.db.client.stockReservation.findMany({
      where: { orderId, releasedAt: null },
      select: { id: true, variantId: true, cartId: true, quantity: true, expiresAt: true },
      orderBy: { variantId: 'asc' },
    });
  }

  async transferToOrder(cartId: string, orderId: string, expiresAt: Date): Promise<number> {
    const result = await this.db.client.stockReservation.updateMany({
      where: { cartId, releasedAt: null },
      data: { cartId: null, orderId, expiresAt },
    });
    return result.count;
  }

  async markReleased(id: string, now: Date): Promise<boolean> {
    const result = await this.db.client.stockReservation.updateMany({
      where: { id, releasedAt: null },
      data: { releasedAt: now },
    });
    return result.count === 1;
  }

  findExpired(now: Date, limit: number): Promise<ReservationRecord[]> {
    return this.db.client.stockReservation.findMany({
      where: { releasedAt: null, orderId: null, expiresAt: { lte: now } },
      select: { id: true, variantId: true, cartId: true, quantity: true, expiresAt: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
  }
}
