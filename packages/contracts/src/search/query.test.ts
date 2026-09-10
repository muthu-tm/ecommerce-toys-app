import { describe, expect, it } from 'vitest';

import { money } from '../primitives/money';

import {
  DEFAULT_PRODUCT_SORT,
  FacetCountsSchema,
  MAX_FILTER_VALUES,
  PriceBandSchema,
  ProductQuerySchema,
  ProductSortSchema,
  ProductSummarySchema,
} from './query';

/**
 * The catalogue query contract.
 *
 * Two properties matter more than the rest. An **empty** query must be valid, because
 * that is what the top-level listing sends. And a query the engine cannot serve must
 * be **rejected here**, before it reaches the adapter — a Firestore error surfacing
 * from a driver has no field to attach a message to, so the customer gets a 500 for
 * what is really a bad filter combination.
 */

describe('ProductQuerySchema', () => {
  it('accepts an empty query and fills in the defaults', () => {
    const query = ProductQuerySchema.parse({});

    expect(query.sort).toBe(DEFAULT_PRODUCT_SORT);
    expect(query.limit).toBe(24);
    expect(query.cursor).toBeUndefined();
  });

  it('defaults to newest first', () => {
    // A catalogue's front page is what is new, not what is cheap.
    expect(DEFAULT_PRODUCT_SORT).toBe('newest');
  });

  it('accepts every sort the catalogue offers', () => {
    for (const sort of ProductSortSchema.options) {
      expect(ProductQuerySchema.safeParse({ sort }).success).toBe(true);
    }
  });

  it('rejects a sort that is not in the enum', () => {
    // Every option needs a composite index, so an open-ended sort parameter is an
    // invitation to request a query that errors at runtime.
    expect(ProductQuerySchema.safeParse({ sort: 'relevance' }).success).toBe(false);
    expect(ProductQuerySchema.safeParse({ sort: 'priceFromMinor:asc' }).success).toBe(false);
  });

  it('accepts filters up to the Firestore ceiling', () => {
    const slugs = Array.from(
      { length: MAX_FILTER_VALUES },
      (_unused, index) => `cat-${String(index)}`,
    );

    expect(ProductQuerySchema.safeParse({ categorySlugs: slugs }).success).toBe(true);
  });

  it('rejects one value past the ceiling, on every multi-value filter', () => {
    const overflow = Array.from(
      { length: MAX_FILTER_VALUES + 1 },
      (_unused, index) => `value-${String(index)}`,
    );

    expect(ProductQuerySchema.safeParse({ categorySlugs: overflow }).success).toBe(false);
    expect(ProductQuerySchema.safeParse({ ageBands: overflow }).success).toBe(false);
    expect(ProductQuerySchema.safeParse({ brands: overflow }).success).toBe(false);
  });

  it('rejects filtering by price while sorting by rating', () => {
    // Firestore permits one range field per query and `priceFromMinor` is it. Caught
    // here rather than at the adapter, so the failure names `sort`.
    const result = ProductQuerySchema.safeParse({
      price: { minMinor: 10_000 },
      sort: 'rating_desc',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual(['sort']);
  });

  it('allows sorting by rating with no price filter', () => {
    expect(ProductQuerySchema.safeParse({ sort: 'rating_desc' }).success).toBe(true);
  });

  it('allows a price filter with a price sort', () => {
    expect(
      ProductQuerySchema.safeParse({ price: { minMinor: 10_000 }, sort: 'price_asc' }).success,
    ).toBe(true);
  });

  it('allows an empty price object alongside a rating sort', () => {
    // No bound means no range field, so there is nothing to conflict with.
    expect(ProductQuerySchema.safeParse({ price: {}, sort: 'rating_desc' }).success).toBe(true);
  });

  it('rejects a page size above the maximum rather than capping it', () => {
    // Silently returning fewer results than asked for makes a client's pagination look
    // broken for a reason it cannot see.
    expect(ProductQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(ProductQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('rejects a slug that is not a slug', () => {
    expect(ProductQuerySchema.safeParse({ categorySlugs: ['Wooden Toys'] }).success).toBe(false);
  });
});

describe('PriceBandSchema', () => {
  it('accepts a one-sided band in either direction', () => {
    // "Under ₹500" and "over ₹2000" without a sentinel standing in for infinity.
    expect(PriceBandSchema.safeParse({ maxMinor: 50_000 }).success).toBe(true);
    expect(PriceBandSchema.safeParse({ minMinor: 200_000 }).success).toBe(true);
  });

  it('accepts an equal minimum and maximum', () => {
    expect(PriceBandSchema.safeParse({ minMinor: 1_000, maxMinor: 1_000 }).success).toBe(true);
  });

  it('rejects an inverted band', () => {
    // An inverted band returns nothing, which reads as an empty catalogue rather than
    // a fixable filter.
    const result = PriceBandSchema.safeParse({ minMinor: 200_000, maxMinor: 50_000 });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual(['minMinor']);
  });

  it('rejects a fractional amount', () => {
    expect(PriceBandSchema.safeParse({ minMinor: 199.5 }).success).toBe(false);
  });
});

describe('ProductSummarySchema', () => {
  const summary = {
    id: 'wooden-blocks',
    slug: 'wooden-blocks',
    name: 'Wooden building blocks',
    brand: 'Woodwise',
    categorySlug: 'building-sets',
    ageBand: '6-8',
    badge: null,
    priceFromMinor: money(129_900),
    mrpFromMinor: money(149_900),
    ratingAvg: 4.6,
    ratingCount: 18,
    cover: {
      path: 'products/wooden-blocks/cover.webp',
      alt: 'A tower of blocks',
      width: 1_200,
      height: 1_200,
      blurhash: null,
    },
    inStock: true,
    variantCount: 2,
  };

  it('accepts a card projection', () => {
    const result = ProductSummarySchema.safeParse(summary);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it('accepts a product with no cover image', () => {
    // A freshly seeded store has no photography until the admin pipeline runs, and the
    // listing has to render regardless.
    expect(ProductSummarySchema.safeParse({ ...summary, cover: null }).success).toBe(true);
  });

  it('carries availability as a boolean, never a count', () => {
    // Exact stock is staff-only. A count on a public projection would hand it back.
    expect(ProductSummarySchema.safeParse({ ...summary, inStock: 3 }).success).toBe(false);
  });

  it('omits the fields a card does not render', () => {
    // The projection exists to keep a 24-item page from carrying 24 descriptions and
    // 24 token arrays.
    const parsed = ProductSummarySchema.parse({
      ...summary,
      description: 'Five thousand characters of copy',
      searchTokens: ['woo', 'wood'],
    });

    expect(parsed).not.toHaveProperty('description');
    expect(parsed).not.toHaveProperty('searchTokens');
  });
});

describe('FacetCountsSchema', () => {
  it('records which dimensions were actually counted', () => {
    // A UI must not render "Wooden toys (0)" when the truth is "we did not count".
    const parsed = FacetCountsSchema.parse({
      categories: { wooden: 4 },
      ageBands: {},
      brands: {},
      countedDimensions: ['categories'],
    });

    expect(parsed.countedDimensions).toEqual(['categories']);
    expect(parsed.ageBands).toEqual({});
  });

  it('accepts counting nothing at all', () => {
    expect(
      FacetCountsSchema.safeParse({
        categories: {},
        ageBands: {},
        brands: {},
        countedDimensions: [],
      }).success,
    ).toBe(true);
  });

  it('rejects a dimension name it does not know', () => {
    expect(
      FacetCountsSchema.safeParse({
        categories: {},
        ageBands: {},
        brands: {},
        countedDimensions: ['colour'],
      }).success,
    ).toBe(false);
  });

  it('rejects a negative count', () => {
    expect(
      FacetCountsSchema.safeParse({
        categories: { wooden: -1 },
        ageBands: {},
        brands: {},
        countedDimensions: ['categories'],
      }).success,
    ).toBe(false);
  });
});
