-- Fase 5 (pedidos y checkout): envío gratis por umbral, datos del pedido para
-- invitados y vencimiento del pago, IVA por línea y número de pedido por secuencia.

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "guestAccessTokenHash" TEXT,
ADD COLUMN     "paymentDueAt" TIMESTAMP(3),
ADD COLUMN     "privacyPolicyVersion" TEXT,
ADD COLUMN     "shippingMethodId" UUID,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
ADD COLUMN     "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ShippingMethod" ADD COLUMN     "estimatedDelivery" TEXT,
ADD COLUMN     "freeShippingThreshold" DECIMAL(12,2),
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Order_guestAccessTokenHash_key" ON "Order"("guestAccessTokenHash");

-- CreateIndex
CREATE INDEX "Order_status_paymentDueAt_idx" ON "Order"("status", "paymentDueAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "ShippingMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Números de pedido "TCC-000001": siempre de la base, nunca del cliente.
-- Una secuencia puede saltarse números (transacciones revertidas); no se reutilizan.
CREATE SEQUENCE "order_number_seq" START 1;

-- Restricciones que Prisma no expresa (también en prisma/sql/constraints.sql).
ALTER TABLE "ShippingMethod" ADD CONSTRAINT "shipping_method_free_threshold_nonneg"
  CHECK ("freeShippingThreshold" IS NULL OR "freeShippingThreshold" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_tax_valid"
  CHECK ("taxTotal" >= 0 AND "taxTotal" <= "lineTotal" AND "taxRate" >= 0 AND "taxRate" <= 1);
