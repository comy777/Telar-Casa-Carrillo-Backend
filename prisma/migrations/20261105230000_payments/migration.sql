-- Fase 6 (pagos): medio de pago, motivo de revisión y fallos de reembolso.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paymentMethodType" TEXT,
ADD COLUMN     "reviewReason" TEXT;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "failureReason" TEXT;

-- CreateIndex
CREATE INDEX "Payment_status_updatedAt_idx" ON "Payment"("status", "updatedAt");

