import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { ProductDoc } from '@romp/contracts';
import { aProduct } from '@romp/contracts/fixtures';
import { UnsupportedQueryError } from '@romp/observability';

import { fixedClock } from '../clock';
import { asCustomer, asOperator, createStoreContext } from '../context';
import type { Caller } from '../context';
import type { WithId } from '../converter';

import { createMemorySearchPort } from './memory';

/**
 * The in-memory adapter.
 *
 * The point of this file is that the adapter is a *safe* stand-in for Firestore in a
 * page test — so most of what is asserted is that it behaves like the real one where the
 * real one's behaviour is a contract: which queries it refuses, how it orders, how it
 * pages, what it projects. A stand-in that diverged on any of those would let a page test
 * pass on behaviour production does not have.
 */

const ctx = createStoreContext({
  storeId: 'romp',
  db: {} as Firestore,
  clock: fixedClock(new Date('2026-03-01T09:30:00.000Z')),
});
const CUSTOMER: Caller = asCustomer('customer-1');
const STAFF: Caller = asOperator('staff-1', 'staff');

/** A product with an explicit id, priced and dated so ordering is assertable. */
function product(id: string, overrides: Partial<ProductDoc> = {}): WithId<ProductDoc> {
  return { ...aProduct(), id, ...overrides };
}

const CATALOGUE: readonly WithId<ProductDoc>[] = [
  product('cheap', {
    slug: 'cheap' as ProductDoc['slug'],
    priceFromMinor: 10_000 as ProductDoc['priceFromMinor'],
    mrpFromMinor: 10_000 as ProductDoc['mrpFromMinor'],
    ratingAvg: 3,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    categorySlug: 'wooden' as ProductDoc['categorySlug'],
    brand: 'Kaadu',
  }),
  product('mid', {
    slug: 'mid' as ProductDoc['slug'],
    priceFromMinor: 50_000 as ProductDoc['priceFromMinor'],
    mrpFromMinor: 50_000 as ProductDoc['mrpFromMinor'],
    ratingAvg: 5,
    publishedAt: new Date('2026-02-01T00:00:00.000Z'),
    categorySlug: 'puzzles' as ProductDoc['categorySlug'],
    brand: 'Chotu Co.',
  }),
  product('dear', {
    slug: 'dear' as ProductDoc['slug'],
    priceFromMinor: 90_000 as ProductDoc['priceFromMinor'],
    mrpFromMinor: 90_000 as ProductDoc['mrpFromMinor'],
    ratingAvg: 4,
    publishedAt: new Date('2026-03-01T00:00:00.000Z'),
    categorySlug: 'wooden' as ProductDoc['categorySlug'],
    brand: 'Kaadu',
  }),
  product('draft', {
    slug: 'draft' as ProductDoc['slug'],
    status: 'draft',
    priceFromMinor: 20_000 as ProductDoc['priceFromMinor'],
    mrpFromMinor: 20_000 as ProductDoc['mrpFromMinor'],
    publishedAt: null,
  }),
];

const port = createMemorySearchPort({ products: CATALOGUE });

describe('visibility', () => {
  it('excludes drafts for a customer', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, { limit: 50 });

    expect(page.items.map((item) => item.slug)).not.toContain('draft');
  });

  it('includes drafts for staff', async () => {
    const page = await port.searchProducts(ctx, STAFF, { limit: 50 });

    expect(page.items.map((item) => item.slug)).toContain('draft');
  });
});

describe('filters', () => {
  it('filters by a single category', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, { categorySlugs: ['puzzles'] });

    expect(page.items.map((item) => item.slug)).toEqual(['mid']);
  });

  it('filters by several categories', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, {
      categorySlugs: ['wooden', 'puzzles'],
      limit: 50,
    });

    expect(page.items.length).toBe(3);
  });

  it('treats an empty filter array as no filter', async () => {
    // `in []` matches nothing in Firestore; the adapter must not reproduce that, or an
    // empty selection would empty the catalogue.
    const page = await port.searchProducts(ctx, CUSTOMER, { categorySlugs: [], limit: 50 });

    expect(page.items.length).toBe(3);
  });

  it('filters by brand', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, { brands: ['Kaadu'], limit: 50 });

    expect(page.items.map((item) => item.slug).sort()).toEqual(['cheap', 'dear']);
  });

  it('filters by a price band when sorted by price', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, {
      price: { minMinor: 40_000, maxMinor: 60_000 },
      sort: 'price_asc',
    });

    expect(page.items.map((item) => item.slug)).toEqual(['mid']);
  });

  it('reduces free text to a prefix token and matches on it', async () => {
    const withTokens = createMemorySearchPort({
      products: [
        product('a', {
          slug: 'a' as ProductDoc['slug'],
          searchTokens: ['be', 'bee', 'beech'] as ProductDoc['searchTokens'],
        }),
      ],
    });

    expect((await withTokens.searchProducts(ctx, CUSTOMER, { text: 'beech' })).items).toHaveLength(
      1,
    );
    expect((await withTokens.searchProducts(ctx, CUSTOMER, { text: 'zzz' })).items).toHaveLength(0);
  });
});

describe('sorting', () => {
  it('sorts by price ascending', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, { sort: 'price_asc', limit: 50 });

    expect(page.items.map((item) => item.slug)).toEqual(['cheap', 'mid', 'dear']);
  });

  it('sorts by price descending', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, { sort: 'price_desc', limit: 50 });

    expect(page.items.map((item) => item.slug)).toEqual(['dear', 'mid', 'cheap']);
  });

  it('sorts by rating', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, { sort: 'rating_desc', limit: 50 });

    expect(page.items.map((item) => item.slug)).toEqual(['mid', 'dear', 'cheap']);
  });

  it('sorts newest first, with nulls last', async () => {
    // A draft with no publish date must not lead a "newest" listing. Staff see it, so it
    // is the case that exercises the null ordering.
    const page = await port.searchProducts(ctx, STAFF, { sort: 'newest', limit: 50 });

    expect(page.items.map((item) => item.slug)).toEqual(['dear', 'mid', 'cheap', 'draft']);
  });

  it('breaks ties by document ID, so paging is total', async () => {
    const tied = createMemorySearchPort({
      products: [
        product('b', {
          slug: 'b' as ProductDoc['slug'],
          priceFromMinor: 5_000 as ProductDoc['priceFromMinor'],
          mrpFromMinor: 5_000 as ProductDoc['mrpFromMinor'],
        }),
        product('a', {
          slug: 'a' as ProductDoc['slug'],
          priceFromMinor: 5_000 as ProductDoc['priceFromMinor'],
          mrpFromMinor: 5_000 as ProductDoc['mrpFromMinor'],
        }),
      ],
    });

    const page = await tied.searchProducts(ctx, CUSTOMER, { sort: 'price_asc', limit: 50 });

    expect(page.items.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('pagination', () => {
  it('returns a cursor when there is more, and walks the catalogue without loss', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 10; page += 1) {
      const result = await port.searchProducts(ctx, CUSTOMER, {
        sort: 'price_asc',
        limit: 1,
        cursor: cursor,
      });
      seen.push(...result.items.map((item) => item.slug));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }

    expect(seen).toEqual(['cheap', 'mid', 'dear']);
  });

  it('emits no cursor on the last page', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, { sort: 'price_asc', limit: 50 });

    expect(page.nextCursor).toBeNull();
  });

  it('refuses a cursor bound to a different sort', async () => {
    // The same protection the Firestore adapter gives, so a page test cannot pass on a
    // cursor reuse that production rejects.
    const first = await port.searchProducts(ctx, CUSTOMER, { sort: 'price_asc', limit: 1 });
    if (first.nextCursor === null) throw new Error('expected a cursor');

    await expect(
      port.searchProducts(ctx, CUSTOMER, { sort: 'newest', cursor: first.nextCursor }),
    ).rejects.toThrow(UnsupportedQueryError);
  });
});

describe('query guards match the Firestore adapter', () => {
  it('refuses eleven filter values, so it never serves the first ten', async () => {
    // The query schema caps multi-value filters at ten, so the rejection comes from
    // there. What matters is that eleven values never yield a truncated result set — the
    // adapter's own guard firing when the schema is bypassed is covered in the plan test.
    const eleven = Array.from({ length: 11 }, (_unused, index) => `brand-${String(index)}`);

    await expect(port.searchProducts(ctx, CUSTOMER, { brands: eleven })).rejects.toThrow();
  });

  it('refuses a price filter sorted by rating', async () => {
    await expect(
      port.searchProducts(ctx, CUSTOMER, { price: { minMinor: 1_000 }, sort: 'rating_desc' }),
    ).rejects.toThrow();
  });

  it('refuses a price filter sorted by newest — the shared guard, not the schema', async () => {
    // The schema permits price + newest; the shared `assertQueryServable` is what refuses
    // it, because a range field forces the sort to that field. This proves the adapter
    // runs the guard, rather than leaning on the schema.
    await expect(
      port.searchProducts(ctx, CUSTOMER, { price: { minMinor: 1_000 }, sort: 'newest' }),
    ).rejects.toThrow(UnsupportedQueryError);
  });
});

describe('the in-stock filter', () => {
  const outOfStock = product('out', {
    slug: 'out' as ProductDoc['slug'],
    variantSummary: aProduct().variantSummary.map((variant) => ({ ...variant, inStock: false })),
  });
  const stockPort = createMemorySearchPort({
    products: [product('in', { slug: 'in' as ProductDoc['slug'] }), outOfStock],
  });

  it('drops products with nothing sellable in stock', async () => {
    const page = await stockPort.searchProducts(ctx, CUSTOMER, { inStockOnly: true, limit: 50 });

    expect(page.items.map((item) => item.slug)).toEqual(['in']);
  });

  it('returns everything when the filter is off', async () => {
    const page = await stockPort.searchProducts(ctx, CUSTOMER, { limit: 50 });

    expect(page.items).toHaveLength(2);
  });
});

describe('suggest and facets', () => {
  it('suggests published products by prefix, highest-rated first', async () => {
    const suggestPort = createMemorySearchPort({
      products: [
        product('low', {
          slug: 'low' as ProductDoc['slug'],
          ratingAvg: 2,
          searchTokens: ['ro', 'rob', 'robot'] as ProductDoc['searchTokens'],
        }),
        product('high', {
          slug: 'high' as ProductDoc['slug'],
          ratingAvg: 5,
          searchTokens: ['ro', 'rob', 'robot'] as ProductDoc['searchTokens'],
        }),
      ],
    });

    const suggestions = await suggestPort.suggest(ctx, CUSTOMER, 'robot');

    expect(suggestions.map((suggestion) => suggestion.slug)).toEqual(['high', 'low']);
  });

  it('suggests nothing for a prefix too short to discriminate', async () => {
    expect(await port.suggest(ctx, CUSTOMER, 'a')).toEqual([]);
  });

  it('serves facet counts from the supplied map', async () => {
    const withCounts = createMemorySearchPort({
      products: CATALOGUE,
      facetCounts: { wooden: 2, puzzles: 1 },
    });

    const facets = await withCounts.facets(ctx, CUSTOMER, {});

    expect(facets.categories).toEqual({ wooden: 2, puzzles: 1 });
    expect(facets.countedDimensions).toEqual(['categories']);
  });

  it('reports empty counts when none are supplied', async () => {
    const facets = await port.facets(ctx, CUSTOMER, {});

    expect(facets.categories).toEqual({});
  });
});

describe('projection', () => {
  it('returns card summaries, not full documents', async () => {
    const page = await port.searchProducts(ctx, CUSTOMER, { limit: 1 });
    const [item] = page.items;

    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('description');
    expect(item).not.toHaveProperty('searchTokens');
    expect(item?.inStock).toBe(true);
  });
});
