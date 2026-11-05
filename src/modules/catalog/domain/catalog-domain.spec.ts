import { BusinessRuleViolation, type DomainError } from '../../../shared/domain/errors';
import { Category } from './category';
import { ancestorsOf, descendantIdsOf, subtreeHeightOf } from './category-tree';
import { pesosToCents } from './money';
import { type NewVariant, normalizeMaterials, Product, type ProductDetails } from './product';
import { resolveSlug, slugify } from './slug';

const now = new Date('2026-11-05T12:00:00Z');

const details: ProductDetails = {
  name: 'Mochila Wayuu Tradicional',
  sku: 'moch-way',
  description: 'Tejida a mano en La Guajira.',
};

const variant = (overrides: Partial<NewVariant> = {}): NewVariant => ({
  name: 'Única',
  sku: 'MOCH-WAY-U',
  priceCents: pesosToCents(185_000),
  ...overrides,
});

const image = { url: 'https://cdn.example.com/a.jpg', storageKey: 'products/a' };

/** Código del error de dominio que lanza `fn`. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DomainError).code;
  }
  throw new Error('No lanzó error');
}

describe('slug', () => {
  it.each([
    ['Mochila Wayuu', 'mochila-wayuu'],
    ['Hamaca  Ñapa — Grande!', 'hamaca-napa-grande'],
    ['  Café   orgánico  ', 'cafe-organico'],
    ['Artesanía 100% hecha a mano', 'artesania-100-hecha-a-mano'],
  ])('convierte "%s" en "%s"', (text, slug) => {
    expect(slugify(text)).toBe(slug);
  });

  it('usa el slug explícito si tiene el formato correcto', () => {
    expect(resolveSlug('mi-mochila', 'Otro nombre')).toBe('mi-mochila');
  });

  it.each(['Con Mayúsculas', 'doble--guion', '-inicio', 'con espacio'])(
    'rechaza el slug explícito "%s"',
    (slug) => {
      expect(codeOf(() => resolveSlug(slug, 'x'))).toBe('INVALID_SLUG');
    },
  );

  it('rechaza un nombre del que no sale ningún slug', () => {
    expect(codeOf(() => resolveSlug(undefined, '¡¡¡'))).toBe('INVALID_SLUG');
  });
});

describe('Product', () => {
  const create = (variants = [variant()]) => Product.create(details, variants, now);

  it('se crea en borrador, con slug derivado y SKU en mayúsculas', () => {
    const s = create().toSnapshot();
    expect(s).toMatchObject({
      status: 'DRAFT',
      slug: 'mochila-wayuu-tradicional',
      sku: 'MOCH-WAY',
      taxRateBasisPoints: 1900,
    });
    expect(s.variants).toHaveLength(1);
  });

  it('exige al menos una variante', () => {
    expect(codeOf(() => create([]))).toBe('VARIANT_REQUIRED');
  });

  it('rechaza SKU repetidos dentro del producto', () => {
    expect(codeOf(() => create([variant(), variant({ name: 'Otra' })]))).toBe('SKU_TAKEN');
  });

  it('exige que el precio anterior sea mayor que el actual', () => {
    expect(codeOf(() => create([variant({ compareAtPriceCents: pesosToCents(185_000) })]))).toBe(
      'COMPARE_AT_PRICE_NOT_HIGHER',
    );
  });

  it('rechaza precios negativos o con fracciones de centavo', () => {
    expect(codeOf(() => create([variant({ priceCents: -1 })]))).toBe('INVALID_PRICE');
    expect(codeOf(() => create([variant({ priceCents: 10.5 })]))).toBe('INVALID_PRICE');
  });

  it('normaliza los atributos de la variante', () => {
    const product = create([variant({ attributes: { Color: ' Natural ' } })]);
    expect(product.toSnapshot().variants[0]?.attributes).toEqual({ color: 'Natural' });
  });

  describe('publicación', () => {
    it('no se publica sin imagen', () => {
      const product = create();
      expect(codeOf(() => product.changeStatus('ACTIVE'))).toBe('PRODUCT_NOT_PUBLISHABLE');
    });

    it('no se publica sin variantes activas', () => {
      const product = create([variant({ isActive: false })]);
      product.addImage(image);
      expect(() => product.changeStatus('ACTIVE')).toThrow(/variante activa/);
    });

    it('se publica con una variante activa y una imagen', () => {
      const product = create();
      product.addImage(image);
      product.changeStatus('ACTIVE');
      expect(product.isPublished).toBe(true);
    });

    it('un archivado vuelve a borrador antes de publicarse', () => {
      const product = create();
      product.changeStatus('ARCHIVED');
      expect(codeOf(() => product.changeStatus('ACTIVE'))).toBe('INVALID_STATUS_TRANSITION');
      product.changeStatus('DRAFT');
      expect(product.status).toBe('DRAFT');
    });

    it('publicado, no permite desactivar la última variante activa ni quitar la última imagen', () => {
      const product = create();
      const img = product.addImage(image);
      product.changeStatus('ACTIVE');
      const [only] = product.toSnapshot().variants;
      expect(codeOf(() => product.updateVariant(only!.id, { isActive: false }))).toBe(
        'LAST_ACTIVE_VARIANT',
      );
      expect(codeOf(() => product.removeImage(img.id))).toBe('LAST_IMAGE');
    });
  });

  describe('imágenes', () => {
    it('la primera queda como principal y el orden crece', () => {
      const product = create();
      const first = product.addImage(image);
      const second = product.addImage({ ...image, storageKey: 'products/b' });
      expect(first).toMatchObject({ isPrimary: true, sortOrder: 0 });
      expect(second).toMatchObject({ isPrimary: false, sortOrder: 1 });
    });

    it('cambiar la principal desmarca la anterior', () => {
      const product = create();
      const first = product.addImage(image);
      const second = product.addImage(image);
      product.updateImage(second.id, { isPrimary: true });
      const images = product.toSnapshot().images;
      expect(images.find((i) => i.id === first.id)?.isPrimary).toBe(false);
      expect(images.find((i) => i.id === second.id)?.isPrimary).toBe(true);
    });

    it('no se puede desmarcar la principal sin elegir otra', () => {
      const product = create();
      const first = product.addImage(image);
      expect(codeOf(() => product.updateImage(first.id, { isPrimary: false }))).toBe(
        'PRIMARY_IMAGE_REQUIRED',
      );
    });

    it('al quitar la principal, la siguiente pasa a ser principal', () => {
      const product = create();
      const first = product.addImage(image);
      const second = product.addImage(image);
      expect(product.removeImage(first.id).storageKey).toBe('products/a');
      expect(product.toSnapshot().images).toEqual([
        expect.objectContaining({ id: second.id, isPrimary: true }),
      ]);
    });

    it('solo asocia imágenes a variantes del producto', () => {
      const product = create();
      expect(() => product.addImage({ ...image, variantId: crypto.randomUUID() })).toThrow(
        /Variante/,
      );
    });
  });

  it('normaliza y deduplica materiales', () => {
    expect(normalizeMaterials(['  lana   de OVEJA ', 'Lana de oveja', 'algodón'])).toEqual([
      'Lana de oveja',
      'Algodón',
    ]);
  });

  it('el slug no cambia al renombrar salvo que se pida', () => {
    const product = create();
    product.update({ name: 'Mochila nueva' });
    expect(product.toSnapshot().slug).toBe('mochila-wayuu-tradicional');
    product.update({ slug: 'mochila-nueva' });
    expect(product.toSnapshot().slug).toBe('mochila-nueva');
  });

  it('rechaza un texto obligatorio vacío', () => {
    const product = create();
    expect(() => product.update({ description: '   ' })).toThrow(BusinessRuleViolation);
  });
});

describe('Category', () => {
  it('impide ciclos y más de tres niveles', () => {
    const root = Category.create({ name: 'Hogar' }, null);
    const child = Category.create({ name: 'Cocina' }, { parentId: root.id, ancestorIds: [] });
    expect(codeOf(() => root.moveTo({ parentId: child.id, ancestorIds: [root.id] }, 1))).toBe(
      'CATEGORY_CYCLE',
    );

    const grandchild = Category.create(
      { name: 'Individuales' },
      { parentId: child.id, ancestorIds: [root.id] },
    );
    expect(grandchild.parentId).toBe(child.id);
    expect(
      codeOf(() =>
        Category.create(
          { name: 'Demasiado' },
          { parentId: grandchild.id, ancestorIds: [child.id, root.id] },
        ),
      ),
    ).toBe('CATEGORY_TOO_DEEP');
  });

  it('devuelve la clave anterior al cambiar la imagen', () => {
    const category = Category.create({ name: 'Hogar' }, null);
    expect(category.setImage('https://x/1.jpg', 'categories/1')).toBeNull();
    expect(category.setImage('https://x/2.jpg', 'categories/2')).toBe('categories/1');
    expect(category.clearImage()).toBe('categories/2');
  });
});

describe('árbol de categorías', () => {
  const nodes = [
    { id: 'hogar', parentId: null },
    { id: 'cocina', parentId: 'hogar' },
    { id: 'individuales', parentId: 'cocina' },
    { id: 'moda', parentId: null },
  ];

  it('calcula ancestros, descendientes y altura', () => {
    expect(ancestorsOf('individuales', nodes).map((n) => n.id)).toEqual(['cocina', 'hogar']);
    expect(descendantIdsOf('hogar', nodes).sort()).toEqual(['cocina', 'hogar', 'individuales']);
    expect(subtreeHeightOf('hogar', nodes)).toBe(2);
    expect(subtreeHeightOf('moda', nodes)).toBe(0);
  });

  it('no se cuelga con datos cíclicos', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(ancestorsOf('a', cyclic).map((n) => n.id)).toEqual(['b']);
    expect(descendantIdsOf('a', cyclic).sort()).toEqual(['a', 'b']);
    expect(subtreeHeightOf('a', cyclic)).toBe(1);
  });
});
