import type { ProductQuery, ProductSort } from '@romp/contracts';
import { AgeBandSchema, ProductSortSchema, SlugSchema } from '@romp/contracts';

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
 * Route-fixed filters — a category slug on `/c/[slug]`, an age band on `/age/[band]` —
 * are merged in by the page. Query-string `c` / `age` values are *additional* filters
 * the listing sidebar writes.
 */

export interface ListingFixedFilter {
  readonly categorySlugs?: readonly string[];
  readonly ageBands?: readonly string[];
}

export interface ParsedListingParams {
  readonly query: ProductQuery;
  readonly sort: ProductSort;
  readonly inStockOnly: boolean;
  readonly categorySlugs: readonly string[];
  readonly ageBands: readonly string[];
  readonly text: string | undefined;
}

/** A single value from a possibly-repeated param. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Every value of a possibly-repeated param, also splitting a comma-separated single
 * value so `?c=wooden,puzzles` and `?c=wooden&c=puzzles` mean the same thing.
 */
function all(value: string | string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter((entry) => entry !== '');
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

function parseSlugs(values: readonly string[]): readonly string[] {
  return values.filter((value) => SlugSchema.safeParse(value).success);
}

function parseAgeBands(values: readonly string[]): readonly string[] {
  return values.filter((value) => AgeBandSchema.safeParse(value).success);
}

export function parseListingParams(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): ParsedListingParams {
  let sort = parseSort(first(searchParams.sort));
  const inStockOnly = first(searchParams.inStock) === 'true';
  const cursor = first(searchParams.cursor);
  const textRaw = first(searchParams.q)?.trim();
  const text = textRaw !== undefined && textRaw !== '' ? textRaw : undefined;

  const minMinor = parsePriceBound(first(searchParams.minPrice));
  const maxMinor = parsePriceBound(first(searchParams.maxPrice));
  const hasPrice = minMinor !== undefined || maxMinor !== undefined;

  // Firestore permits one range field per query. Price + rating is unservable, so a
  // bookmarked combination falls back to newest rather than 500-ing the page.
  if (hasPrice && sort === 'rating_desc') sort = 'newest';

  const categorySlugs = parseSlugs(all(searchParams.c));
  const ageBands = parseAgeBands(all(searchParams.age));

  return {
    sort,
    inStockOnly,
    categorySlugs,
    ageBands,
    text,
    query: {
      sort,
      inStockOnly: inStockOnly ? true : undefined,
      ...(hasPrice ? { price: { minMinor, maxMinor } } : {}),
      ...(cursor !== undefined ? { cursor: cursor } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(categorySlugs.length > 0 ? { categorySlugs: [...categorySlugs] } : {}),
      ...(ageBands.length > 0 ? { ageBands: [...ageBands] } : {}),
    },
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}

/**
 * Combines route-fixed filters with the query-string extras the sidebar wrote.
 *
 * Empty arrays from `/c/all` mean "no category filter", not `in []`.
 */
export function mergeListingQuery(
  parsed: ParsedListingParams,
  fixed: ListingFixedFilter = {},
): ProductQuery {
  const categorySlugs = unique([...(fixed.categorySlugs ?? []), ...parsed.categorySlugs]);
  const ageBands = unique([...(fixed.ageBands ?? []), ...parsed.ageBands]);

  const { categorySlugs: _parsedCategories, ageBands: _parsedAges, ...base } = parsed.query;

  return {
    ...base,
    ...(categorySlugs.length > 0 ? { categorySlugs } : {}),
    ...(ageBands.length > 0 ? { ageBands } : {}),
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
  if (parsed.text !== undefined) params.set('q', parsed.text);

  for (const slug of parsed.categorySlugs) params.append('c', slug);
  for (const band of parsed.ageBands) params.append('age', band);

  const price = parsed.query.price;
  if (price?.minMinor !== undefined) params.set('minPrice', String(price.minMinor));
  if (price?.maxMinor !== undefined) params.set('maxPrice', String(price.maxMinor));

  return params;
}
