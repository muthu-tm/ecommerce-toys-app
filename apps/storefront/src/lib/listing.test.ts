import { describe, expect, it } from 'vitest';

import { mergeListingQuery, parseListingParams, preservedParams } from './listing';

/**
 * Parsing `searchParams` into a `ProductQuery`.
 *
 * The property that matters: a **malformed** param falls back to the default rather than
 * being passed through to fail schema validation, so a bookmarked `?sort=nonsense` renders
 * the default listing instead of a 400 the customer cannot fix.
 */

describe('parseListingParams', () => {
  it('defaults an empty query to newest, in stock off', () => {
    const parsed = parseListingParams({});

    expect(parsed.sort).toBe('newest');
    expect(parsed.inStockOnly).toBe(false);
    expect(parsed.query.cursor).toBeUndefined();
  });

  it('falls back to newest for an unknown sort rather than erroring', () => {
    expect(parseListingParams({ sort: 'nonsense' }).sort).toBe('newest');
  });

  it('accepts each known sort', () => {
    for (const sort of ['newest', 'price_asc', 'price_desc', 'rating_desc'] as const) {
      expect(parseListingParams({ sort }).sort).toBe(sort);
    }
  });

  it('treats inStock=true as the only truthy value', () => {
    expect(parseListingParams({ inStock: 'true' }).inStockOnly).toBe(true);
    expect(parseListingParams({ inStock: 'false' }).inStockOnly).toBe(false);
    expect(parseListingParams({ inStock: '1' }).inStockOnly).toBe(false);
  });

  it('parses a price band in paise', () => {
    const parsed = parseListingParams({ minPrice: '50000', maxPrice: '200000' });

    expect(parsed.query.price).toEqual({ minMinor: 50_000, maxMinor: 200_000 });
  });

  it('ignores a non-integer price bound', () => {
    const parsed = parseListingParams({ minPrice: 'lots' });

    expect(parsed.query.price).toBeUndefined();
  });

  it('takes the first value when a param repeats', () => {
    expect(parseListingParams({ sort: ['price_asc', 'newest'] }).sort).toBe('price_asc');
  });

  it('carries a cursor through untouched', () => {
    expect(parseListingParams({ cursor: 'ABC' }).query.cursor).toBe('ABC');
  });

  it('parses extra category and age filters from the query string', () => {
    const parsed = parseListingParams({ c: ['wooden', 'puzzles'], age: '6-8' });

    expect(parsed.categorySlugs).toEqual(['wooden', 'puzzles']);
    expect(parsed.ageBands).toEqual(['6-8']);
    expect(parsed.query.categorySlugs).toEqual(['wooden', 'puzzles']);
  });

  it('accepts a comma-separated category param', () => {
    expect(parseListingParams({ c: 'wooden,puzzles' }).categorySlugs).toEqual([
      'wooden',
      'puzzles',
    ]);
  });

  it('drops a junk category slug rather than failing the page', () => {
    expect(parseListingParams({ c: 'NOT A SLUG' }).categorySlugs).toEqual([]);
  });

  it('reads a search text query', () => {
    expect(parseListingParams({ q: ' stack ' }).text).toBe('stack');
    expect(parseListingParams({ q: '   ' }).text).toBeUndefined();
  });

  it('falls back from rating sort when a price filter is also present', () => {
    expect(parseListingParams({ sort: 'rating_desc', minPrice: '50000' }).sort).toBe('newest');
  });
});

describe('mergeListingQuery', () => {
  it('unions route-fixed filters with query-string extras', () => {
    const parsed = parseListingParams({ c: 'puzzles', age: '3-5' });
    const query = mergeListingQuery(parsed, { categorySlugs: ['wooden'], ageBands: ['6-8'] });

    expect(query.categorySlugs).toEqual(['wooden', 'puzzles']);
    expect(query.ageBands).toEqual(['6-8', '3-5']);
  });

  it('treats an empty fixed category list as no filter', () => {
    const query = mergeListingQuery(parseListingParams({}), { categorySlugs: [] });

    expect(query.categorySlugs).toBeUndefined();
  });
});

describe('preservedParams', () => {
  it('keeps the sort and filters but never the cursor', () => {
    const parsed = parseListingParams({
      sort: 'price_asc',
      inStock: 'true',
      minPrice: '50000',
      cursor: 'ABC',
    });

    const params = preservedParams(parsed);

    expect(params.get('sort')).toBe('price_asc');
    expect(params.get('inStock')).toBe('true');
    expect(params.get('minPrice')).toBe('50000');
    expect(params.get('cursor')).toBeNull();
  });

  it('preserves extra category, age and text filters', () => {
    const params = preservedParams(
      parseListingParams({ c: 'wooden', age: '6-8', q: 'ring', inStock: 'true' }),
    );

    expect(params.get('c')).toBe('wooden');
    expect(params.get('age')).toBe('6-8');
    expect(params.get('q')).toBe('ring');
    expect(params.get('inStock')).toBe('true');
  });

  it('omits the default sort, keeping the first-page URL clean', () => {
    const params = preservedParams(parseListingParams({}));

    expect(params.toString()).toBe('');
  });

  it('rebuilds from parsed state, dropping any junk the URL carried', () => {
    const params = preservedParams(parseListingParams({ sort: 'price_asc', junk: 'x' }));

    expect(params.has('junk')).toBe(false);
  });
});
