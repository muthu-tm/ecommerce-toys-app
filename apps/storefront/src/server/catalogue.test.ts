import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductDoc } from '@romp/contracts';
import { aProduct } from '@romp/contracts/fixtures';
import { createMemorySearchPort } from '@romp/data';
import type { WithId } from '@romp/data';

/**
 * The storefront read layer.
 *
 * `./firebase` is mocked so the layer never touches the Admin SDK: `catalogueAvailable`
 * is forced true (this is a "datastore reachable" run), and `db`/`storeId` return stubs
 * the in-memory adapter ignores. The `SearchPort` itself is supplied through the global
 * test override, so what these tests exercise is the *caching and caller layer* — the
 * anonymous-caller default, the featured/rail query shapes, the build-time empty fallback
 * — over a known adapter, not Firestore.
 */
vi.mock('./firebase', () => ({
  catalogueAvailable: () => available,
  db: () => ({}) as never,
  storeId: () => 'test-store',
}));

let available = true;

const withId = (id: string, overrides: Partial<ProductDoc> = {}): WithId<ProductDoc> => ({
  ...aProduct(),
  id,
  ...overrides,
});

const CATALOGUE = [
  withId('a', {
    slug: 'a' as ProductDoc['slug'],
    categorySlug: 'wooden' as ProductDoc['categorySlug'],
    publishedAt: new Date('2026-01-01'),
  }),
  withId('b', {
    slug: 'b' as ProductDoc['slug'],
    categorySlug: 'wooden' as ProductDoc['categorySlug'],
    publishedAt: new Date('2026-03-01'),
  }),
  withId('c', {
    slug: 'c' as ProductDoc['slug'],
    categorySlug: 'puzzles' as ProductDoc['categorySlug'],
    publishedAt: new Date('2026-02-01'),
  }),
];

beforeEach(() => {
  available = true;
  globalThis.__ROMP_TEST_SEARCH_PORT = createMemorySearchPort({ products: CATALOGUE });
});

afterEach(() => {
  globalThis.__ROMP_TEST_SEARCH_PORT = undefined;
  vi.resetModules();
});

describe('searchProducts', () => {
  it('returns products through the configured adapter', async () => {
    const { searchProducts } = await import('./catalogue');
    const page = await searchProducts({ limit: 50 });

    expect(page.items.map((item) => item.slug).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty page when no datastore is reachable, for a build', async () => {
    // A build has no project. The page renders a shell and ISR fills it on first request.
    available = true;
    globalThis.__ROMP_TEST_SEARCH_PORT = undefined;
    available = false;

    const { searchProducts } = await import('./catalogue');
    const page = await searchProducts({ limit: 50 });

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe('featuredProducts', () => {
  it('returns the newest products, limited', async () => {
    const { featuredProducts } = await import('./catalogue');
    const featured = await featuredProducts(2);

    // Newest first: b (Mar), c (Feb).
    expect(featured.map((product) => product.slug)).toEqual(['b', 'c']);
  });
});

describe('categoryRail', () => {
  it('returns the newest products in one category', async () => {
    const { categoryRail } = await import('./catalogue');
    const rail = await categoryRail('wooden', 10);

    expect(rail.map((product) => product.slug)).toEqual(['b', 'a']);
  });

  it('is empty for a category with no products', async () => {
    const { categoryRail } = await import('./catalogue');

    expect(await categoryRail('outdoor', 10)).toEqual([]);
  });
});

describe('suggest', () => {
  it('returns matching slugs', async () => {
    globalThis.__ROMP_TEST_SEARCH_PORT = createMemorySearchPort({
      products: [
        withId('robot', {
          slug: 'robot' as ProductDoc['slug'],
          searchTokens: ['ro', 'rob', 'robot'] as ProductDoc['searchTokens'],
        }),
      ],
    });

    const { suggest } = await import('./catalogue');

    expect(await suggest('robot')).toEqual(['robot']);
  });

  it('is empty at build time', async () => {
    globalThis.__ROMP_TEST_SEARCH_PORT = undefined;
    available = false;

    const { suggest } = await import('./catalogue');

    expect(await suggest('robot')).toEqual([]);
  });
});

describe('the build-time fallback', () => {
  it('returns null for a product and empty for categories when unavailable', async () => {
    globalThis.__ROMP_TEST_SEARCH_PORT = undefined;
    available = false;

    const { getProduct, getNavCategories, getCategory } = await import('./catalogue');

    expect(await getProduct('a')).toBeNull();
    expect(await getNavCategories()).toEqual([]);
    expect(await getCategory('wooden')).toBeNull();
  });
});
