import { describe, expect, it } from 'vitest';

import { parseListingParams, preservedParams } from './listing';

/**
 * Parsing `searchParams` into a `ProductQuery`.
 *
 * The property that matters: a **malformed** param falls back to the default rather than
 * being passed through to fail schema validation, so a bookmarked `?sort=nonsense` renders
 * the default listing instead of a 400 the customer cannot fix. A **well-formed but
 * unservable** combination still reaches the adapter and is refused there, as it should be.
 */

describe('parseListingParams', () => {
  it('defaults an empty query to newest, in stock off', () => {
    const parsed = parseListingParams({});

    expect(parsed.sort).toBe('newest');
    expect(parsed.inStockOnly).toBe(false);
    expect(parsed.query.cursor).toBeUndefined();
  });

  it('falls back to newest for an unknown sort rather than erroring', () => {
    // The bookmarked-junk case. The schema is still the final authority; this only keeps a
    // malformed value from becoming a 400.
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
    // A junk price param should not produce a filter that then fails validation.
    const parsed = parseListingParams({ minPrice: 'lots' });

    expect(parsed.query.price).toBeUndefined();
  });

  it('takes the first value when a param repeats', () => {
    expect(parseListingParams({ sort: ['price_asc', 'newest'] }).sort).toBe('price_asc');
  });

  it('carries a cursor through untouched', () => {
    expect(parseListingParams({ cursor: 'ABC' }).query.cursor).toBe('ABC');
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

  it('omits the default sort, keeping the first-page URL clean', () => {
    const params = preservedParams(parseListingParams({}));

    expect(params.toString()).toBe('');
  });

  it('rebuilds from parsed state, dropping any junk the URL carried', () => {
    // A param the parser did not recognise does not ride along into the next-page URL.
    const params = preservedParams(parseListingParams({ sort: 'price_asc', junk: 'x' }));

    expect(params.has('junk')).toBe(false);
  });
});
