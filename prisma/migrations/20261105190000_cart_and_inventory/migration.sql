-- Fase 4 (carrito e inventario): saldo tras cada movimiento, un carrito por
-- usuario e índices para el carrito y para liberar reservas vencidas.

-- DropIndex
DROP INDEX "Cart_userId_updatedAt_idx";

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "onHandAfter" INTEGER NOT NULL,
ADD COLUMN     "reservedAfter" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

-- CreateIndex
CREATE INDEX "Cart_expiresAt_idx" ON "Cart"("expiresAt");

-- CreateIndex
CREATE INDEX "StockReservation_cartId_releasedAt_idx" ON "StockReservation"("cartId", "releasedAt");

-- Restricciones que Prisma no expresa (también en prisma/sql/constraints.sql).
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "inventory_movement_balances_valid"
  CHECK ("onHandAfter" >= 0 AND "reservedAfter" >= 0 AND "reservedAfter" <= "onHandAfter");

-- Solo las reservas activas interesan al proceso que libera las vencidas.
CREATE INDEX "reservation_active_expiry" ON "StockReservation" ("expiresAt") WHERE "releasedAt" IS NULL;
