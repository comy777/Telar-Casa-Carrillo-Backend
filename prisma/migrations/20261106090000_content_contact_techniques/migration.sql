-- CreateEnum
CREATE TYPE "ContactMessageStatus" AS ENUM ('NEW', 'READ', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Banner" ADD COLUMN     "ctaLabel" TEXT,
ADD COLUMN     "imageAlt" TEXT,
ADD COLUMN     "imageKey" TEXT;

-- AlterTable
ALTER TABLE "NewsletterSubscriber" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "policyVersion" TEXT,
ADD COLUMN     "tokenHash" TEXT;

-- AlterTable
ALTER TABLE "Testimonial" ADD COLUMN     "location" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Technique" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Technique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTechnique" (
    "productId" UUID NOT NULL,
    "techniqueId" UUID NOT NULL,

    CONSTRAINT "ProductTechnique_pkey" PRIMARY KEY ("productId","techniqueId")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "status" "ContactMessageStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Technique_name_key" ON "Technique"("name");

-- CreateIndex
CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_tokenHash_key" ON "NewsletterSubscriber"("tokenHash");

-- AddForeignKey
ALTER TABLE "ProductTechnique" ADD CONSTRAINT "ProductTechnique_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTechnique" ADD CONSTRAINT "ProductTechnique_techniqueId_fkey" FOREIGN KEY ("techniqueId") REFERENCES "Technique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

