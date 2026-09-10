import type { Query } from 'firebase-admin/firestore';

import type {
  Cursor,
  FacetCounts,
  Paged,
  ProductDoc,
  ProductQuery,
  ProductSummary,
  ResolvedProductQuery,
  Suggestion,
} from '@romp/contracts';
import { PUBLIC_PRODUCT_STATUS, ProductQuerySchema, ProductStatusSchema } from '@romp/contracts';

import type { Caller, StoreContext } from '../context';
import { isStaff } from '../context';
import { converters } from '../converters';
import { decodeCursor, encodeCursor } from '../cursor';
import { COLLECTIONS } from '../paths';
import { listCategories } from '../repositories/catalogue';
import { runQuery } from '../repositories/read';
import { searchQueryToken } from '../search-tokens';

import {
  SORT_FIELDS,
  assertQueryServable,
  isSellableInStock,
  sortValueOf,
  toProductSummary,
} from './plan';
import type { SearchPort } from './port';

export { toProductSummary } from './plan';

/**
 * The Firestore `SearchPort` adapter.
 *
 * This is the **only** file in the platform that turns a `ProductQuery` into a Firestore
 * query, and that containment is what ADR-0002 buys. When Typesense arrives, a sibling
 * file implements the same interface and callers are untouched.
 *
 * Everything below is shaped by Firestore's documented limits rather than fighting them:
 * one range field per query, `in` capped at ten values, no facet counting, no full-text
 * search. Where a limit is reached the adapter **raises a typed error** rather than
 * returning a plausible subset — a silently truncated filter is a wrong-results bug
 * nobody reports, because nobody can see it.
 */

/**
 * Assembles the Firestore query.
 *
 * Clause order is not arbitrary. Firestore requires that when a range filter is present,
 * the first `orderBy` names the same field — which `assertServable` has already
 * guaranteed — and every combination assembled here has a matching composite index in
 * `infra/firestore.indexes.json`. A query with no index does not degrade; it throws at
 * runtime, on the page that needed it.
 */
function buildQuery(
  ctx: StoreContext,
  caller: Caller,
  query: ResolvedProductQuery,
): Query<ProductDoc> {
  let firestoreQuery: Query<ProductDoc> = ctx.db
    .collection(COLLECTIONS.products)
    .withConverter(converters.products);

  // Status first, always. It is the equality filter every composite index leads with, and
  // it is the filter that keeps drafts out of the public catalogue. Staff get the same
  // shape with a widened value set rather than the filter being dropped, so the index is
  // used either way.
  firestoreQuery = isStaff(caller)
    ? firestoreQuery.where('status', 'in', [...ProductStatusSchema.options])
    : firestoreQuery.where('status', '==', PUBLIC_PRODUCT_STATUS);

  const token = query.text === undefined ? null : searchQueryToken(query.text);
  if (token !== null) {
    // Prefix matching on a token array is the ceiling of what Firestore offers. A
    // customer typing `helicoptor` finds nothing, which is the documented weak point.
    firestoreQuery = firestoreQuery.where('searchTokens', 'array-contains', token);
  }

  if (query.categorySlugs !== undefined && query.categorySlugs.length > 0) {
    firestoreQuery =
      query.categorySlugs.length === 1
        ? // A single value uses `==` rather than a one-element `in`, because the two use
          // different indexes and the equality form is the one the category listing page
          // has an index for.
          firestoreQuery.where('categorySlug', '==', query.categorySlugs[0])
        : firestoreQuery.where('categorySlug', 'in', [...query.categorySlugs]);
  }

  if (query.ageBands !== undefined && query.ageBands.length > 0) {
    firestoreQuery =
      query.ageBands.length === 1
        ? firestoreQuery.where('ageBand', '==', query.ageBands[0])
        : firestoreQuery.where('ageBand', 'in', [...query.ageBands]);
  }

  if (query.brands !== undefined && query.brands.length > 0) {
    firestoreQuery =
      query.brands.length === 1
        ? firestoreQuery.where('brand', '==', query.brands[0])
        : firestoreQuery.where('brand', 'in', [...query.brands]);
  }

  if (query.price?.minMinor !== undefined) {
    firestoreQuery = firestoreQuery.where('priceFromMinor', '>=', query.price.minMinor);
  }
  if (query.price?.maxMinor !== undefined) {
    firestoreQuery = firestoreQuery.where('priceFromMinor', '<=', query.price.maxMinor);
  }

  const [field, direction] = SORT_FIELDS[query.sort];
  // The document ID as the final ordering component makes paging total: without it, two
  // products at the same price have no defined order, so a cursor can land in the middle
  // of a tie and either repeat or skip them.
  firestoreQuery = firestoreQuery.orderBy(field, direction).orderBy('__name__', direction);

  if (query.cursor !== undefined) {
    const decoded = decodeCursor(query.cursor, query.sort);
    firestoreQuery = firestoreQuery.startAfter(...decoded.sortValues, decoded.documentId);
  }

  // One extra document, so "is there a next page" is known without a second query. The
  // extra is dropped before returning.
  return firestoreQuery.limit(query.limit + 1);
}

export const firestoreSearchPort: SearchPort = {
  async searchProducts(
    ctx: StoreContext,
    caller: Caller,
    query: ProductQuery,
  ): Promise<Paged<ProductSummary>> {
    const resolved = ProductQuerySchema.parse(query);
    // The shared guard, so this adapter and the in-memory one refuse exactly the same
    // queries with exactly the same errors.
    assertQueryServable(resolved);

    const fetched = await runQuery(buildQuery(ctx, caller, resolved));

    // The extra document proves there is more, and is then discarded. Emitting a cursor
    // whenever a page is full would give the last page a cursor to nowhere, and a UI
    // showing "next" on the final page is a dead button.
    const hasMore = fetched.length > resolved.limit;
    const page = hasMore ? fetched.slice(0, resolved.limit) : fetched;
    const last = page.at(-1);

    const nextCursor: Cursor | null =
      hasMore && last !== undefined
        ? encodeCursor(resolved.sort, [sortValueOf(last, resolved.sort)], last.id)
        : null;

    const visible = resolved.inStockOnly === true ? page.filter(isSellableInStock) : page;

    return {
      items: visible.map(toProductSummary),
      nextCursor,
    };
  },

  async suggest(
    ctx: StoreContext,
    // Unused, and named so. Staff see drafts through `searchProducts` but not here: the
    // suggestion box is a customer-facing surface, and a draft appearing in it while an
    // admin happens to be browsing the storefront reads as a leak even though it is not.
    _caller: Caller,
    prefix: string,
    options: { readonly limit?: number } = {},
  ): Promise<readonly Suggestion[]> {
    const token = searchQueryToken(prefix);
    // Fewer than two characters matches nearly the whole catalogue, so there is nothing
    // useful to suggest and the query is skipped rather than issued and truncated.
    if (token === null) return [];

    const products = await runQuery(
      ctx.db
        .collection(COLLECTIONS.products)
        .withConverter(converters.products)
        .where('status', '==', PUBLIC_PRODUCT_STATUS)
        .where('searchTokens', 'array-contains', token)
        // Ordered by rating rather than relevance, because there is no relevance to order
        // by. Highest-rated first is the most defensible proxy available.
        .orderBy('ratingAvg', 'desc')
        .limit(options.limit ?? 6),
    );

    return products.map((product) => ({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      priceFromMinor: product.priceFromMinor,
    }));
  },

  // `_caller` and `_query` are unused, deliberately. Firestore cannot count "how many
  // would match if I also applied this filter", so the query cannot narrow anything here;
  // what is available is the maintained per-category total, which is identical for every
  // caller because categories are public. `countedDimensions` is how a UI learns not to
  // render the dimensions this adapter did not answer.
  async facets(ctx: StoreContext, _caller: Caller, _query: ProductQuery): Promise<FacetCounts> {
    const categories = await listCategories(ctx);

    return {
      categories: Object.fromEntries(
        categories.map((category) => [category.slug, category.productCount]),
      ),
      // Empty rather than absent, and reported as uncounted. A UI must not render
      // "3–5 years (0)" when the truth is "we did not count".
      ageBands: {},
      brands: {},
      countedDimensions: ['categories'],
    };
  },
};
