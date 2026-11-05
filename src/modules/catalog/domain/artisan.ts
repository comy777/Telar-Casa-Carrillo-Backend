import { resolveSlug } from './slug';
import { optionalText, requiredText, TEXT_LIMITS } from './text';

export interface ArtisanProps {
  id: string;
  name: string;
  slug: string;
  biography: string | null;
  story: string | null;
  photoUrl: string | null;
  photoKey: string | null;
  isFeatured: boolean;
  isActive: boolean;
  createdAt: Date;
  /** Lo asigna la base al guardar. */
  updatedAt: Date;
}

export interface ArtisanDetails {
  name: string;
  slug?: string | null | undefined;
  /** Resumen corto para tarjetas. */
  biography?: string | null | undefined;
  /** Historia completa para la página del artesano. */
  story?: string | null | undefined;
  isFeatured?: boolean | undefined;
  isActive?: boolean | undefined;
}

export type ArtisanChanges = Partial<ArtisanDetails>;

/** Creador de los productos. Desactivarlo lo oculta de la tienda, no a sus productos. */
export class Artisan {
  private constructor(private props: ArtisanProps) {}

  static create(details: ArtisanDetails, now: Date): Artisan {
    const artisan = new Artisan({
      id: crypto.randomUUID(),
      name: '',
      slug: '',
      biography: null,
      story: null,
      photoUrl: null,
      photoKey: null,
      isFeatured: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    artisan.update(details);
    return artisan;
  }

  static restore(props: ArtisanProps): Artisan {
    return new Artisan({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  update(changes: ArtisanChanges): void {
    const p = this.props;
    if (changes.name !== undefined) p.name = requiredText(changes.name, 'nombre', TEXT_LIMITS.name);
    if (changes.slug !== undefined || !p.slug) p.slug = resolveSlug(changes.slug, p.name);
    if (changes.biography !== undefined) {
      p.biography = optionalText(changes.biography, 'biografía', TEXT_LIMITS.biography);
    }
    if (changes.story !== undefined) {
      p.story = optionalText(changes.story, 'historia', TEXT_LIMITS.story);
    }
    if (changes.isFeatured !== undefined) p.isFeatured = changes.isFeatured;
    if (changes.isActive !== undefined) p.isActive = changes.isActive;
  }

  /** Devuelve la clave del archivo anterior para borrarlo. */
  setPhoto(url: string, key: string): string | null {
    const previous = this.props.photoKey;
    this.props.photoUrl = url;
    this.props.photoKey = key;
    return previous;
  }

  clearPhoto(): string | null {
    const previous = this.props.photoKey;
    this.props.photoUrl = null;
    this.props.photoKey = null;
    return previous;
  }

  toSnapshot(): Readonly<ArtisanProps> {
    return { ...this.props };
  }
}
