import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Page,
  type RequestContext,
} from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { IMAGE_STORAGE, type ImageStorage } from '../../../shared/application/image-storage';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import {
  type ImageChanges,
  type NewVariant,
  Product,
  type ProductChanges,
  type ProductDetails,
  type ProductStatus,
  type VariantChanges,
} from '../domain/product';
import { deleteImageQuietly, withUploadedImage } from './media';
import {
  type AdminProductQuery,
  ARTISAN_REPOSITORY,
  type ArtisanRepository,
  CATEGORY_REPOSITORY,
  type CategoryRepository,
  PRODUCT_REPOSITORY,
  type ProductRepository,
} from './ports';

export interface Actor {
  id: string;
  context: RequestContext;
}

export interface NewProductImage {
  data: Buffer;
  altText?: string | null | undefined;
  variantId?: string | null | undefined;
}

/** Casos de uso de administración de productos. Todos quedan en auditoría. */
@Injectable()
export class ProductAdministration {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
    @Inject(ARTISAN_REPOSITORY) private readonly artisans: ArtisanRepository,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(query: AdminProductQuery): Promise<Page<Product>> {
    return this.products.list(query);
  }

  async get(id: string): Promise<Product> {
    return this.require(id);
  }

  create(actor: Actor, details: ProductDetails, variants: NewVariant[]): Promise<Product> {
    return this.unitOfWork.execute(async () => {
      await this.assertReferences(details);
      const product = Product.create(details, variants, this.clock.now());
      await this.products.save(product);
      await this.record(actor, 'product.created', product.id, {
        sku: product.toSnapshot().sku,
      });
      return this.require(product.id);
    });
  }

  update(actor: Actor, id: string, changes: ProductChanges): Promise<Product> {
    return this.mutate(actor, id, 'product.updated', async (product) => {
      await this.assertReferences(changes);
      product.update(changes);
      return { fields: Object.keys(changes) };
    });
  }

  changeStatus(actor: Actor, id: string, status: ProductStatus): Promise<Product> {
    return this.mutate(actor, id, 'product.status_changed', (product) => {
      const from = product.status;
      product.changeStatus(status);
      return Promise.resolve({ from, to: status });
    });
  }

  addVariant(actor: Actor, id: string, variant: NewVariant): Promise<Product> {
    return this.mutate(actor, id, 'product.variant_added', (product) => {
      const added = product.addVariant(variant);
      return Promise.resolve({ variantId: added.id, sku: added.sku });
    });
  }

  updateVariant(
    actor: Actor,
    id: string,
    variantId: string,
    changes: VariantChanges,
  ): Promise<Product> {
    return this.mutate(actor, id, 'product.variant_updated', (product) => {
      product.updateVariant(variantId, changes);
      return Promise.resolve({ variantId, fields: Object.keys(changes) });
    });
  }

  async addImage(actor: Actor, id: string, image: NewProductImage): Promise<Product> {
    // Se comprueba antes de subir para no gastar una subida en un producto inexistente.
    await this.require(id);
    return withUploadedImage(this.storage, image.data, 'products', (stored) =>
      this.mutate(actor, id, 'product.image_added', (product) => {
        const added = product.addImage({
          url: stored.url,
          storageKey: stored.key,
          altText: image.altText,
          variantId: image.variantId,
        });
        return Promise.resolve({ imageId: added.id });
      }),
    );
  }

  updateImage(actor: Actor, id: string, imageId: string, changes: ImageChanges): Promise<Product> {
    return this.mutate(actor, id, 'product.image_updated', (product) => {
      product.updateImage(imageId, changes);
      return Promise.resolve({ imageId, fields: Object.keys(changes) });
    });
  }

  async removeImage(actor: Actor, id: string, imageId: string): Promise<Product> {
    let removedKey: string | null = null;
    const product = await this.mutate(actor, id, 'product.image_removed', (current) => {
      removedKey = current.removeImage(imageId).storageKey;
      return Promise.resolve({ imageId });
    });
    // El archivo se borra solo después de confirmar la transacción.
    await deleteImageQuietly(this.storage, removedKey);
    return product;
  }

  // ---------- utilidades ----------

  private async require(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) throw new NotFoundError('Producto', id);
    return product;
  }

  /** Carga, modifica, guarda y audita en una sola transacción. */
  private mutate(
    actor: Actor,
    id: string,
    action: string,
    change: (product: Product) => Promise<Record<string, unknown>>,
  ): Promise<Product> {
    return this.unitOfWork.execute(async () => {
      const product = await this.require(id);
      const metadata = await change(product);
      await this.products.save(product);
      await this.record(actor, action, id, metadata);
      return this.require(id);
    });
  }

  private async assertReferences(changes: ProductChanges): Promise<void> {
    if (changes.artisanId) {
      const artisan = await this.artisans.findById(changes.artisanId);
      if (!artisan) {
        throw new BusinessRuleViolation('El artesano no existe', 'UNKNOWN_ARTISAN', {
          artisanId: changes.artisanId,
        });
      }
    }
    if (changes.categoryIds && changes.categoryIds.length > 0) {
      const requested = [...new Set(changes.categoryIds)];
      const existing = await this.categories.findExistingIds(requested);
      const unknown = requested.filter((categoryId) => !existing.includes(categoryId));
      if (unknown.length > 0) {
        throw new BusinessRuleViolation('Hay categorías que no existen', 'UNKNOWN_CATEGORIES', {
          unknown,
        });
      }
    }
  }

  private record(
    actor: Actor,
    action: string,
    productId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      actorId: actor.id,
      action,
      resource: 'Product',
      resourceId: productId,
      metadata,
      ipAddress: actor.context.ipAddress,
    });
  }
}
