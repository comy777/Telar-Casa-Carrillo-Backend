import { NotFoundError } from '../../../shared/domain/errors';
import type { CatalogReader, PublicCategoryNode } from './ports';
import { Storefront } from './storefront.service';

const node = (id: string, parentId: string | null, sortOrder = 0): PublicCategoryNode => ({
  id,
  parentId,
  name: id,
  slug: id,
  description: null,
  imageUrl: null,
  sortOrder,
});

function setup(active: PublicCategoryNode[]) {
  const reader = {
    listActiveCategories: jest.fn().mockResolvedValue(active),
    listProducts: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
  } as unknown as jest.Mocked<CatalogReader>;
  return { storefront: new Storefront(reader), reader };
}

describe('Storefront', () => {
  // "cocina" está activa pero su padre "hogar" no aparece (está inactivo).
  const categories = [
    node('moda', null, 2),
    node('bolsos', 'moda', 1),
    node('mochilas', 'bolsos'),
    node('accesorios', null, 1),
    node('cocina', 'hogar'),
  ];

  it('arma el árbol ordenado y oculta ramas con ancestros inactivos', async () => {
    const { storefront } = setup(categories);
    const tree = await storefront.categoryTree();
    expect(tree.map((c) => c.slug)).toEqual(['accesorios', 'moda']);
    expect(tree[1]?.children[0]?.children.map((c) => c.slug)).toEqual(['mochilas']);
  });

  it('filtra por categoría incluyendo sus subcategorías', async () => {
    const { storefront, reader } = setup(categories);
    await storefront.searchProducts({ page: 1, pageSize: 20, categorySlug: 'moda' });
    const query = reader.listProducts.mock.calls[0]![0];
    expect(query.categoryIds?.sort()).toEqual(['bolsos', 'mochilas', 'moda']);
    expect(query.sort).toBe('newest');
  });

  it('ordena por relevancia cuando hay búsqueda', async () => {
    const { storefront, reader } = setup(categories);
    await storefront.searchProducts({ page: 1, pageSize: 20, search: 'mochila' });
    expect(reader.listProducts.mock.calls[0]![0].sort).toBe('relevance');
  });

  it('una categoría oculta responde 404', async () => {
    const { storefront } = setup(categories);
    await expect(storefront.getCategory('cocina')).rejects.toThrow(NotFoundError);
    await expect(
      storefront.searchProducts({ page: 1, pageSize: 20, categorySlug: 'cocina' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('devuelve migas de pan de la raíz al padre', async () => {
    const { storefront } = setup(categories);
    const page = await storefront.getCategory('mochilas');
    expect(page.breadcrumbs.map((b) => b.slug)).toEqual(['moda', 'bolsos']);
  });
});
