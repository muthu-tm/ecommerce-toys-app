import type { ProductQuery, ProductSort } from '@romp/contracts';
import { ProductSortSchema } from '@romp/contracts';

/**
 * Turns a page's `searchParams` into a `ProductQuery`.
 *
 * Next hands `searchParams` as `Record<string, string | string[]>`, because a param can
 * repeat. This narrows each one deliberately: an unknown sort falls back to the default
 * rather than being passed through to fail schema validation, so a hand-edited or
 * bookmarked URL with `?sort=nonsense` renders the default listing instead of a 400. The
 * schema is still the final authority — this only keeps a *malformed* param from becoming
 * an error the customer sees, while a *well-formed but unservable* combination still
 * fails, as it should.
 *
 * The extra fields a specific page fixes — a category slug, an age band — are merged in
 * by the page, not parsed here, because they come from the route segment rather than the
 * query string.
 */
export interface ParsedListingParams {
  readonly query: Omit<ProductQuery, 'categorySlugs' | 'ageBands'>;
  /** The raw sort and stock state, for rendering the controls in their current position. */
  readonly sort: ProductSort;
  readonly inStockOnly: boolean;
}

/** A single value from a possibly-repeated param. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseSort(value: string | undefined): ProductSort {
  const result = ProductSortSchema.safeParse(value);
  return result.success ? result.data : 'newest';
}

/** Parses a price bound in paise, ignoring anything that is not a non-negative integer. */
function parsePriceBound(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseListingParams(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): ParsedListingParams {
  const sort = parseSort(first(searchParams.sort));
  const inStockOnly = first(searchParams.inStock) === 'true';
  const cursor = first(searchParams.cursor);

  const minMinor = parsePriceBound(first(searchParams.minPrice));
  const maxMinor = parsePriceBound(first(searchParams.maxPrice));
  const hasPrice = minMinor !== undefined || maxMinor !== undefined;

  return {
    sort,
    inStockOnly,
    query: {
      sort,
      inStockOnly: inStockOnly ? true : undefined,
      ...(hasPrice ? { price: { minMinor, maxMinor } } : {}),
      ...(cursor !== undefined ? { cursor: cursor } : {}),
    },
  };
}

/**
 * The query-string params to preserve across pagination, minus the cursor.
 *
 * Rebuilt from the parsed state rather than passed through raw, so a junk param a
 * bookmark carried does not ride along into the "next page" URL.
 */
export function preservedParams(parsed: ParsedListingParams): URLSearchParams {
  const params = new URLSearchParams();
  if (parsed.sort !== 'newest') params.set('sort', parsed.sort);
  if (parsed.inStockOnly) params.set('inStock', 'true');

  const price = parsed.query.price;
  if (price?.minMinor !== undefined) params.set('minPrice', String(price.minMinor));
  if (price?.maxMinor !== undefined) params.set('maxPrice', String(price.maxMinor));

  return params;
}
