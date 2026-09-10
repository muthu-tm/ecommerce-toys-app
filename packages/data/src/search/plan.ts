import type {
  ProductDoc,
  ProductSort,
  ProductSummary,
  ResolvedProductQuery,
} from '@romp/contracts';
import { MAX_FILTER_VALUES } from '@romp/contracts';
import { TooManyFilterValuesError, UnsupportedQueryError } from '@romp/observability';

import type { WithId } from '../converter';

/**
 * The engine-neutral half of a catalogue search.
 *
 * The two things every adapter must agree on — *which* queries are refused, and *what*
 * a query's sort ordering is — live here rather than in each adapter, so the Firestore
 * adapter and the in-memory one cannot drift apart. A test that passes against the
 * in-memory adapter has to mean something about the Firestore one, and it only does if
 * they share this.
 *
 * Guards raise the same typed errors regardless of engine: an eleventh filter value is
 * `FILTER_LIMIT_EXCEEDED` and a price-plus-rating query is `UNSUPPORTED_QUERY`, whether
 * the query would have run against Firestore or against an array. That matters because
 * the in-memory adapter *could* serve those queries — nothing stops it filtering eleven
 * categories — but if it did, a test would pass on a query production rejects, which is
 * the exact trap the shared adapter interface exists to avoid.
 */

/** A range field forces the sort to that field; these are the only sorts a price band allows. */
const PRICE_SORTS: ReadonlySet<ProductSort> = new Set(['price_asc', 'price_desc']);

/** Whether the query carries a price bound — Firestore's one permitted range field. */
export function hasPriceRange(query: ResolvedProductQuery): boolean {
  return (
    query.price !== undefined &&
    (query.price.minMinor !== undefined || query.price.maxMinor !== undefined)
  );
}

/**
 * Refuses queries no engine in v1.0 serves, with the same errors for every adapter.
 *
 * The filter-limit check is duplicated from the query schema on purpose: the schema
 * catches it at the boundary, and this catches a caller who bypassed the schema, so no
 * adapter can be the component that silently truncates.
 */
export function assertQueryServable(query: ResolvedProductQuery): void {
  assertFilterWithinLimit('categorySlugs', query.categorySlugs);
  assertFilterWithinLimit('ageBands', query.ageBands);
  assertFilterWithinLimit('brands', query.brands);

  if (hasPriceRange(query) && !PRICE_SORTS.has(query.sort)) {
    // Firestore permits one range field per query, and a range forces the first
    // `orderBy` to name it — so a price filter can only be sorted by price. The
    // in-memory adapter honours the same rule so a query that works in a test works in
    // production.
    throw new UnsupportedQueryError({
      limitation: 'one range field per query',
      detail:
        'Filtering by price requires sorting by price. Remove the price filter, or sort by price.',
    });
  }
}

function assertFilterWithinLimit(field: string, values: readonly unknown[] | undefined): void {
  if (values !== undefined && values.length > MAX_FILTER_VALUES) {
    throw new TooManyFilterValuesError({
      field,
      supplied: values.length,
      maximum: MAX_FILTER_VALUES,
    });
  }
}

/** The `orderBy` field and direction each sort maps to, before the document-ID tiebreaker. */
export const SORT_FIELDS: Readonly<Record<ProductSort, readonly [string, 'asc' | 'desc']>> =
  Object.freeze({
    newest: ['publishedAt', 'desc'],
    price_asc: ['priceFromMinor', 'asc'],
    price_desc: ['priceFromMinor', 'desc'],
    rating_desc: ['ratingAvg', 'desc'],
  });

/** The value a cursor carries for a given sort — the field the ordering keys on. */
export function sortValueOf(
  product: WithId<ProductDoc>,
  sort: ProductSort,
): string | number | Date | null {
  switch (sort) {
    case 'newest':
      return product.publishedAt;
    case 'price_asc':
    case 'price_desc':
      return product.priceFromMinor;
    case 'rating_desc':
      return product.ratingAvg;
  }
}

/**
 * Projects a stored product down to what a listing card renders.
 *
 * A projection rather than the whole document: a 24-item page carrying full descriptions,
 * media arrays and token lists is an order of magnitude more bytes for fields the card
 * never shows. It is also what lets a future Typesense adapter return a stored summary
 * without reading Firestore at all.
 */
export function toProductSummary(product: WithId<ProductDoc>): ProductSummary {
  const cover = product.media.find((item) => item.order === 0) ?? product.media[0] ?? null;
  const sellable = product.variantSummary.filter((variant) => variant.active);

  return {
    id: product.id as ProductSummary['id'],
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    categorySlug: product.categorySlug,
    ageBand: product.ageBand,
    badge: product.badge,
    priceFromMinor: product.priceFromMinor,
    mrpFromMinor: product.mrpFromMinor,
    ratingAvg: product.ratingAvg,
    ratingCount: product.ratingCount,
    cover:
      cover === null
        ? null
        : {
            path: cover.path,
            alt: cover.alt,
            width: cover.width,
            height: cover.height,
            blurhash: cover.blurhash,
          },
    // From the denormalised summary, maintained by the variant transaction. A fresh
    // inventory read per product would be one read per card on a 24-item page, for a
    // value that is a boolean and will be re-checked at checkout anyway.
    inStock: sellable.some((variant) => variant.inStock),
    variantCount: sellable.length,
  };
}

/**
 * Whether a product has anything sellable in stock.
 *
 * The in-stock filter runs **in memory**, in both adapters, because `inStock` lives
 * inside the `variantSummary` array and Firestore cannot filter on a field of an array
 * element. The consequence is honest and bounded: an in-stock-filtered page can come
 * back short. The alternatives are a denormalised top-level boolean every variant
 * transaction must maintain plus another index, or looping until the page fills — an
 * unbounded number of queries for a filter most visitors never apply.
 */
export function isSellableInStock(product: WithId<ProductDoc>): boolean {
  return product.variantSummary.some((variant) => variant.active && variant.inStock);
}
