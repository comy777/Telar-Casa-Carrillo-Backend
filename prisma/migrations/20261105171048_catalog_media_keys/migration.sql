-- Fase 3 (catálogo): claves de almacenamiento para poder borrar las imágenes
-- reemplazadas, y una categoría no puede ser su propio padre.

-- AlterTable
ALTER TABLE "Artisan" ADD COLUMN     "photoKey" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "imageKey" TEXT;

ALTER TABLE "Category" ADD CONSTRAINT "category_not_own_parent"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");
