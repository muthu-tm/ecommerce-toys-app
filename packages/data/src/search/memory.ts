import type {
  FacetCounts,
  Paged,
  ProductDoc,
  ProductQuery,
  ProductSummary,
  ResolvedProductQuery,
  Suggestion,
} from '@romp/contracts';
import { PUBLIC_PRODUCT_STATUS, ProductQuerySchema } from '@romp/contracts';

import type { Caller, StoreContext } from '../context';
import { isStaff } from '../context';
import type { WithId } from '../converter';
import { decodeCursor, encodeCursor } from '../cursor';
import { searchQueryToken } from '../search-tokens';

import {
  SORT_FIELDS,
  assertQueryServable,
  isSellableInStock,
  sortValueOf,
  toProductSummary,
} from './plan';
import type { SearchPort } from './port';

/**
 * An in-memory `SearchPort`, for tests.
 *
 * This exists so a listing-page test does not need the Firestore emulator — a JVM, a
 * cold start, a shared database — to assert that the page renders the right products in
 * the right order. Page rendering is React, and React tests should be milliseconds.
 *
 * It is **not** a second production adapter, and the difference is deliberate: it
 * enforces exactly the same query guards as Firestore (`assertQueryServable`), uses the
 * same sort mapping and the same summary projection, and refuses a cursor bound to a
 * different sort the same way. So a query that passes here is a query production would
 * accept — which is the only property that makes it a safe stand-in. What it cannot check
 * is index coverage, because there are no indexes; that stays the job of
 * `infra/tests/indexes.test.ts`.
 *
 * `facets()` is served from an explicit count map the caller supplies, because there is
 * no `categories` collection to read. That keeps the count assertion in the test's hands
 * rather than making the fake compute one and risk diverging from the maintained total.
 */
export interface MemorySearchStore {
  readonly products: readonly WithId<ProductDoc>[];
  /** Category slug → product count, for `facets()`. Absent categories count as zero. */
  readonly facetCounts?: Readonly<Record<string, number>>;
}

/**
 * Compares two non-null sort values. Nulls are handled by the caller, after the
 * direction factor is applied, so that a missing field sorts **last** regardless of
 * direction — a draft with `publishedAt: null` should trail a "newest" listing, not lead
 * it.
 */
function compareSortValues(left: string | number | Date, right: string | number | Date): number {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function matchesQuery(
  product: WithId<ProductDoc>,
  query: ResolvedProductQuery,
  caller: Caller,
): boolean {
  // The status filter, first and always — it is what keeps drafts off the storefront,
  // and the Admin SDK bypass means it is the only thing that does.
  if (!isStaff(caller) && product.status !== PUBLIC_PRODUCT_STATUS) return false;

  if (
    query.categorySlugs !== undefined &&
    query.categorySlugs.length > 0 &&
    !query.categorySlugs.includes(product.categorySlug)
  ) {
    return false;
  }

  if (
    query.ageBands !== undefined &&
    query.ageBands.length > 0 &&
    !query.ageBands.includes(product.ageBand)
  ) {
    return false;
  }

  if (
    query.brands !== undefined &&
    query.brands.length > 0 &&
    !query.brands.includes(product.brand)
  ) {
    return false;
  }

  if (query.price?.minMinor !== undefined && product.priceFromMinor < query.price.minMinor) {
    return false;
  }
  if (query.price?.maxMinor !== undefined && product.priceFromMinor > query.price.maxMinor) {
    return false;
  }

  const token = query.text === undefined ? null : searchQueryToken(query.text);
  if (token !== null && !product.searchTokens.includes(token)) return false;

  return true;
}

function sortProducts(
  products: readonly WithId<ProductDoc>[],
  query: ResolvedProductQuery,
): readonly WithId<ProductDoc>[] {
  const [, direction] = SORT_FIELDS[query.sort];
  const factor = direction === 'asc' ? 1 : -1;

  return [...products].sort((left, right) => {
    const a = sortValueOf(left, query.sort);
    const b = sortValueOf(right, query.sort);

    // Nulls last in every direction — applied outside the direction factor so a missing
    // field never leads the list. This matches how a draft (`publishedAt: null`) sorts in
    // a staff "newest" listing.
    if (a === null || b === null) {
      if (a === null && b === null) return left.id.localeCompare(right.id);
      return a === null ? 1 : -1;
    }

    const byField = compareSortValues(a, b) * factor;
    // The document ID is the tiebreaker, always ascending, so paging is total and two
    // products at the same price have a defined order.
    return byField !== 0 ? byField : left.id.localeCompare(right.id);
  });
}

/**
 * Builds an in-memory adapter over a fixed product set.
 *
 * Deliberately not `readonly` on the store shape at the boundary — a test hands in an
 * array and expects it back untouched, which the filter-and-copy below guarantees.
 */
export function createMemorySearchPort(store: MemorySearchStore): SearchPort {
  const facetCounts = store.facetCounts ?? {};

  /*
   * Every method here is `async` with nothing to await, and that is deliberate rather
   * than accidental. The `SearchPort` contract is async because Firestore is, and making
   * these async means a synchronous guard failure (a bad query, a mismatched cursor)
   * surfaces as a *rejected promise* rather than a synchronous throw — so a caller that
   * `await`s the port cannot tell this stand-in from the real adapter. `require-await` is
   * off for the block for that reason.
   */
  /* eslint-disable @typescript-eslint/require-await */
  return {
    async searchProducts(
      _ctx: StoreContext,
      caller: Caller,
      query: ProductQuery,
    ): Promise<Paged<ProductSummary>> {
      const resolved = ProductQuerySchema.parse(query);
      assertQueryServable(resolved);

      const matched = sortProducts(
        store.products.filter((product) => matchesQuery(product, resolved, caller)),
        resolved,
      );

      // Apply the cursor by finding where the previous page ended. The Firestore adapter
      // does this with `startAfter`; here it is an index into the sorted array, which is
      // the same semantics on a small fixed set. `decodeCursor` still runs when a cursor
      // is present, so a cursor bound to a different sort is refused exactly as in
      // Firestore.
      let startIndex = 0;
      if (resolved.cursor !== undefined) {
        const { documentId } = decodeCursor(resolved.cursor, resolved.sort);
        startIndex = matched.findIndex((product) => product.id === documentId) + 1;
      }

      const window = matched.slice(startIndex, startIndex + resolved.limit + 1);
      const hasMore = window.length > resolved.limit;
      const pageBeforeStock = hasMore ? window.slice(0, resolved.limit) : window;
      const last = pageBeforeStock.at(-1);

      const visible =
        resolved.inStockOnly === true ? pageBeforeStock.filter(isSellableInStock) : pageBeforeStock;

      return {
        items: visible.map(toProductSummary),
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(resolved.sort, [sortValueOf(last, resolved.sort)], last.id)
            : null,
      };
    },

    // reason as above: a rejected promise, not a synchronous throw.
    async suggest(
      _ctx: StoreContext,
      _caller: Caller,
      prefix: string,
      options: { readonly limit?: number } = {},
    ): Promise<readonly Suggestion[]> {
      const token = searchQueryToken(prefix);
      if (token === null) return [];

      const matched = store.products
        .filter(
          (product) =>
            product.status === PUBLIC_PRODUCT_STATUS && product.searchTokens.includes(token),
        )
        .sort((left, right) => right.ratingAvg - left.ratingAvg)
        .slice(0, options.limit ?? 6);

      return matched.map((product) => ({
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        priceFromMinor: product.priceFromMinor,
      }));
    },

    async facets(_ctx: StoreContext, _caller: Caller, _query: ProductQuery): Promise<FacetCounts> {
      return {
        categories: facetCounts,
        ageBands: {},
        brands: {},
        countedDimensions: ['categories'],
      };
    },
  };
  /* eslint-enable @typescript-eslint/require-await */
}
