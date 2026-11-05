import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_TRAIL, type AuditTrail, type Page } from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { IMAGE_STORAGE, type ImageStorage } from '../../../shared/application/image-storage';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import { Artisan, type ArtisanChanges, type ArtisanDetails } from '../domain/artisan';
import {
  Category,
  type CategoryChanges,
  type CategoryDetails,
  type TreePosition,
} from '../domain/category';
import { ancestorsOf, subtreeHeightOf } from '../domain/category-tree';
import { deleteImageQuietly, withUploadedImage } from './media';
import {
  ARTISAN_REPOSITORY,
  type ArtisanListQuery,
  type ArtisanRepository,
  CATEGORY_REPOSITORY,
  type CategoryRepository,
} from './ports';
import type { Actor } from './product-administration.service';

/** Cambio de padre: `undefined` lo deja igual, `null` la vuelve raíz. */
export type ParentChange = string | null | undefined;

@Injectable()
export class CategoryAdministration {
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  /** Todas, activas o no, en orden de presentación. */
  list(): Promise<Category[]> {
    return this.categories.findAll();
  }

  create(actor: Actor, details: CategoryDetails, parentId: string | null): Promise<Category> {
    return this.unitOfWork.execute(async () => {
      const all = await this.categories.findAll();
      const category = Category.create(details, parentId ? this.positionOf(parentId, all) : null);
      await this.categories.save(category);
      await this.record(actor, 'category.created', category.id, { parentId });
      return category;
    });
  }

  update(
    actor: Actor,
    id: string,
    changes: CategoryChanges,
    parentId: ParentChange,
  ): Promise<Category> {
    return this.unitOfWork.execute(async () => {
      const all = await this.categories.findAll();
      const category = this.find(id, all);
      category.update(changes);
      if (parentId !== undefined) {
        category.moveTo(
          parentId ? this.positionOf(parentId, all) : null,
          subtreeHeightOf(
            id,
            all.map((c) => ({ id: c.id, parentId: c.parentId })),
          ),
        );
      }
      await this.categories.save(category);
      await this.record(actor, 'category.updated', id, {
        fields: [...Object.keys(changes), ...(parentId !== undefined ? ['parentId'] : [])],
      });
      return category;
    });
  }

  /** Solo sin subcategorías ni productos: si no, desactivarla. */
  async delete(actor: Actor, id: string): Promise<void> {
    const imageKey = await this.unitOfWork.execute(async () => {
      const all = await this.categories.findAll();
      const category = this.find(id, all);
      if (all.some((c) => c.parentId === id)) {
        throw new BusinessRuleViolation(
          'La categoría tiene subcategorías; muévelas o bórralas primero',
          'CATEGORY_HAS_CHILDREN',
        );
      }
      const products = await this.categories.countProducts(id);
      if (products > 0) {
        throw new BusinessRuleViolation(
          'La categoría tiene productos; desactívala en lugar de borrarla',
          'CATEGORY_IN_USE',
          { products },
        );
      }
      await this.categories.delete(id);
      await this.record(actor, 'category.deleted', id, { slug: category.toSnapshot().slug });
      return category.toSnapshot().imageKey;
    });
    await deleteImageQuietly(this.storage, imageKey);
  }

  async setImage(actor: Actor, id: string, data: Buffer): Promise<Category> {
    await this.require(id);
    let previousKey: string | null = null;
    const category = await withUploadedImage(this.storage, data, 'categories', (stored) =>
      this.unitOfWork.execute(async () => {
        const current = await this.require(id);
        previousKey = current.setImage(stored.url, stored.key);
        await this.categories.save(current);
        await this.record(actor, 'category.image_changed', id, {});
        return current;
      }),
    );
    await deleteImageQuietly(this.storage, previousKey);
    return category;
  }

  async removeImage(actor: Actor, id: string): Promise<Category> {
    let previousKey: string | null = null;
    const category = await this.unitOfWork.execute(async () => {
      const current = await this.require(id);
      previousKey = current.clearImage();
      await this.categories.save(current);
      await this.record(actor, 'category.image_removed', id, {});
      return current;
    });
    await deleteImageQuietly(this.storage, previousKey);
    return category;
  }

  private async require(id: string): Promise<Category> {
    const category = await this.categories.findById(id);
    if (!category) throw new NotFoundError('Categoría', id);
    return category;
  }

  private find(id: string, all: Category[]): Category {
    const category = all.find((c) => c.id === id);
    if (!category) throw new NotFoundError('Categoría', id);
    return category;
  }

  private positionOf(parentId: string, all: Category[]): TreePosition {
    const nodes = all.map((c) => ({ id: c.id, parentId: c.parentId }));
    if (!nodes.some((node) => node.id === parentId)) {
      throw new BusinessRuleViolation('La categoría padre no existe', 'UNKNOWN_PARENT_CATEGORY', {
        parentId,
      });
    }
    return { parentId, ancestorIds: ancestorsOf(parentId, nodes).map((node) => node.id) };
  }

  private record(
    actor: Actor,
    action: string,
    id: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      actorId: actor.id,
      action,
      resource: 'Category',
      resourceId: id,
      metadata,
      ipAddress: actor.context.ipAddress,
    });
  }
}

@Injectable()
export class ArtisanAdministration {
  constructor(
    @Inject(ARTISAN_REPOSITORY) private readonly artisans: ArtisanRepository,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(query: ArtisanListQuery): Promise<Page<Artisan>> {
    return this.artisans.list(query);
  }

  get(id: string): Promise<Artisan> {
    return this.require(id);
  }

  create(actor: Actor, details: ArtisanDetails): Promise<Artisan> {
    return this.unitOfWork.execute(async () => {
      const artisan = Artisan.create(details, this.clock.now());
      await this.artisans.save(artisan);
      await this.record(actor, 'artisan.created', artisan.id, {});
      return this.require(artisan.id);
    });
  }

  update(actor: Actor, id: string, changes: ArtisanChanges): Promise<Artisan> {
    return this.unitOfWork.execute(async () => {
      const artisan = await this.require(id);
      artisan.update(changes);
      await this.artisans.save(artisan);
      await this.record(actor, 'artisan.updated', id, { fields: Object.keys(changes) });
      return this.require(id);
    });
  }

  async setPhoto(actor: Actor, id: string, data: Buffer): Promise<Artisan> {
    await this.require(id);
    let previousKey: string | null = null;
    const artisan = await withUploadedImage(this.storage, data, 'artisans', (stored) =>
      this.unitOfWork.execute(async () => {
        const current = await this.require(id);
        previousKey = current.setPhoto(stored.url, stored.key);
        await this.artisans.save(current);
        await this.record(actor, 'artisan.photo_changed', id, {});
        return this.require(id);
      }),
    );
    await deleteImageQuietly(this.storage, previousKey);
    return artisan;
  }

  async removePhoto(actor: Actor, id: string): Promise<Artisan> {
    let previousKey: string | null = null;
    const artisan = await this.unitOfWork.execute(async () => {
      const current = await this.require(id);
      previousKey = current.clearPhoto();
      await this.artisans.save(current);
      await this.record(actor, 'artisan.photo_removed', id, {});
      return this.require(id);
    });
    await deleteImageQuietly(this.storage, previousKey);
    return artisan;
  }

  private async require(id: string): Promise<Artisan> {
    const artisan = await this.artisans.findById(id);
    if (!artisan) throw new NotFoundError('Artesano', id);
    return artisan;
  }

  private record(
    actor: Actor,
    action: string,
    id: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      actorId: actor.id,
      action,
      resource: 'Artisan',
      resourceId: id,
      metadata,
      ipAddress: actor.context.ipAddress,
    });
  }
}
