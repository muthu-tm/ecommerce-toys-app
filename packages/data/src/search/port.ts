import type { FacetCounts, Paged, ProductQuery, ProductSummary, Suggestion } from '@romp/contracts';

import type { Caller, StoreContext } from '../context';

/**
 * The catalogue search seam (ADR-0002).
 *
 * v1.0 is served by Firestore; v1.1 adds a Typesense adapter behind this same
 * interface. Three commitments make that swap contained rather than aspirational, and
 * all three are properties of *callers*, not of the adapter:
 *
 *  1. **No `firebase-admin` import outside the adapter.** Route handlers and server
 *     components see `SearchPort` only. If a page reaches around the port to assemble a
 *     query, the swap stops being contained and the port has failed.
 *  2. **Documented limits raise typed errors instead of degrading silently.** Eleven
 *     category filters throws `TooManyFilterValuesError`; it does not quietly return
 *     results for the first ten.
 *  3. **The query is engine-neutral.** `ProductQuery` describes intent, and cursors are
 *     opaque strings, so pagination can change representation without touching a URL.
 *
 * The interface is designed against the **target** capability, not today's. `facets()`
 * exists in v1.0 and answers only the category dimension, reporting which dimensions it
 * actually counted — so when Typesense fills in the rest, no caller changes and no UI
 * has to learn a new shape.
 */
export interface SearchPort {
  /**
   * Finds products matching a query.
   *
   * Takes the caller because visibility depends on it: staff see drafts, customers do
   * not. Any adapter that ignored it would publish the unpublished catalogue, and since
   * this runs through the Admin SDK nothing else would stop it.
   */
  searchProducts: (
    ctx: StoreContext,
    caller: Caller,
    query: ProductQuery,
  ) => Promise<Paged<ProductSummary>>;

  /**
   * Type-ahead suggestions for the search box.
   *
   * Separate from `searchProducts` because it is a different query shape and a different
   * budget: it runs on every few keystrokes, returns a handful of rows, and must never
   * paginate. Folding it into `searchProducts` with a small `limit` would let a keystroke
   * accidentally inherit filters and sorting the box does not have.
   */
  suggest: (
    ctx: StoreContext,
    caller: Caller,
    prefix: string,
    options?: { readonly limit?: number },
  ) => Promise<readonly Suggestion[]>;

  /**
   * Facet counts for the filter sidebar.
   *
   * Takes the same query, because a facet count is "how many would match if I also
   * applied this" — a number that depends on the filters already applied. v1.0 cannot
   * compute that from Firestore, so it returns maintained totals and says so through
   * `countedDimensions` rather than returning plausible wrong numbers.
   */
  facets: (ctx: StoreContext, caller: Caller, query: ProductQuery) => Promise<FacetCounts>;
}
