-- CreateEnum
CREATE TYPE "QuoteKind" AS ENUM ('EVENT', 'GROUP_VISIT', 'COURT_RENTAL');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'QUOTED', 'CLOSED');

-- CreateTable
CREATE TABLE "VenueActivity" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "imageKey" TEXT,
    "imageAlt" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" UUID NOT NULL,
    "kind" "QuoteKind" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "eventDate" DATE,
    "startTime" TEXT,
    "durationHours" INTEGER,
    "people" INTEGER,
    "activityNames" TEXT[],
    "includesFood" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "policyVersion" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'NEW',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteRequest_status_createdAt_idx" ON "QuoteRequest"("status", "createdAt");

-- Ruta «Visítanos» del storefront. ON CONFLICT: no pisa lo que el panel ya haya cambiado.
INSERT INTO "StoreRoute" ("key", "path", "label", "description", "isEnabled", "isLocked", "showInHeader", "footerGroup", "sortOrder", "updatedAt") VALUES
  ('visitanos', '/visitanos', 'Visítanos', 'El lugar: comida, juegos y cotizaciones', true, false, true, 'SHOP', 35, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
