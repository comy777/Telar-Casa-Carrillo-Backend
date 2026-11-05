import { Module } from '@nestjs/common';
import {
  ARTISAN_REPOSITORY,
  CATALOG_READER,
  CATEGORY_REPOSITORY,
  PRODUCT_REPOSITORY,
} from './application/ports';
import { ProductAdministration } from './application/product-administration.service';
import { Storefront } from './application/storefront.service';
import {
  ArtisanAdministration,
  CategoryAdministration,
} from './application/taxonomy-administration.service';
import { PrismaCatalogReader } from './infrastructure/prisma-catalog.reader';
import {
  PrismaArtisanRepository,
  PrismaCategoryRepository,
  PrismaProductRepository,
} from './infrastructure/prisma-catalog.repositories';
import { AdminProductsController } from './presentation/admin-products.controller';
import {
  AdminArtisansController,
  AdminCategoriesController,
} from './presentation/admin-taxonomy.controller';
import { StorefrontController } from './presentation/storefront.controller';

@Module({
  controllers: [
    StorefrontController,
    AdminProductsController,
    AdminCategoriesController,
    AdminArtisansController,
  ],
  providers: [
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
    { provide: CATEGORY_REPOSITORY, useClass: PrismaCategoryRepository },
    { provide: ARTISAN_REPOSITORY, useClass: PrismaArtisanRepository },
    { provide: CATALOG_READER, useClass: PrismaCatalogReader },
    ProductAdministration,
    CategoryAdministration,
    ArtisanAdministration,
    Storefront,
  ],
})
export class CatalogModule {}
