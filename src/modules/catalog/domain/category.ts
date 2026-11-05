import { BusinessRuleViolation } from '../../../shared/domain/errors';
import { resolveSlug } from './slug';
import { optionalText, requiredText, TEXT_LIMITS } from './text';

/** Profundidad máxima del árbol (raíz = 1), p. ej. Hogar › Cocina › Individuales. */
export const MAX_CATEGORY_DEPTH = 3;

export interface CategoryProps {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  imageKey: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CategoryDetails {
  name: string;
  slug?: string | null | undefined;
  description?: string | null | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

export type CategoryChanges = Partial<CategoryDetails>;

/** Ubicación de un padre en el árbol: su id y los de sus ancestros (del más cercano a la raíz). */
export interface TreePosition {
  parentId: string;
  ancestorIds: string[];
}

export class Category {
  private constructor(private props: CategoryProps) {}

  static create(details: CategoryDetails, parent: TreePosition | null): Category {
    const category = new Category({
      id: crypto.randomUUID(),
      parentId: null,
      name: '',
      slug: '',
      description: null,
      imageUrl: null,
      imageKey: null,
      isActive: true,
      sortOrder: 0,
    });
    category.update(details);
    category.moveTo(parent, 0);
    return category;
  }

  static restore(props: CategoryProps): Category {
    return new Category({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get parentId(): string | null {
    return this.props.parentId;
  }

  update(changes: CategoryChanges): void {
    const p = this.props;
    if (changes.name !== undefined) p.name = requiredText(changes.name, 'nombre', TEXT_LIMITS.name);
    if (changes.slug !== undefined || !p.slug) p.slug = resolveSlug(changes.slug, p.name);
    if (changes.description !== undefined) {
      p.description = optionalText(
        changes.description,
        'descripción',
        TEXT_LIMITS.categoryDescription,
      );
    }
    if (changes.isActive !== undefined) p.isActive = changes.isActive;
    if (changes.sortOrder !== undefined) {
      if (!Number.isInteger(changes.sortOrder) || changes.sortOrder < 0) {
        throw new BusinessRuleViolation('El orden debe ser un entero positivo', 'INVALID_ORDER');
      }
      p.sortOrder = changes.sortOrder;
    }
  }

  /**
   * Cambia el padre. `subtreeHeight` es cuántos niveles cuelgan de esta
   * categoría (0 si no tiene hijas), para no superar la profundidad máxima.
   */
  moveTo(parent: TreePosition | null, subtreeHeight: number): void {
    if (!parent) {
      this.props.parentId = null;
      return;
    }
    if (parent.parentId === this.props.id || parent.ancestorIds.includes(this.props.id)) {
      throw new BusinessRuleViolation(
        'Una categoría no puede quedar dentro de sí misma',
        'CATEGORY_CYCLE',
      );
    }
    const depth = parent.ancestorIds.length + 2 + subtreeHeight;
    if (depth > MAX_CATEGORY_DEPTH) {
      throw new BusinessRuleViolation(
        `Las categorías admiten hasta ${MAX_CATEGORY_DEPTH} niveles`,
        'CATEGORY_TOO_DEEP',
        { max: MAX_CATEGORY_DEPTH },
      );
    }
    this.props.parentId = parent.parentId;
  }

  /** Devuelve la clave del archivo anterior para borrarlo. */
  setImage(url: string, key: string): string | null {
    const previous = this.props.imageKey;
    this.props.imageUrl = url;
    this.props.imageKey = key;
    return previous;
  }

  clearImage(): string | null {
    const previous = this.props.imageKey;
    this.props.imageUrl = null;
    this.props.imageKey = null;
    return previous;
  }

  toSnapshot(): Readonly<CategoryProps> {
    return { ...this.props };
  }
}
