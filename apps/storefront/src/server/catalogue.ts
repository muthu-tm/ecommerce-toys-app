import 'server-only';

import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import type {
  CategoryDoc,
  FacetCounts,
  Paged,
  ProductDoc,
  ProductQuery,
  ProductSummary,
  PublicReviewView,
  VariantOption,
} from '@romp/contracts';
import {
  ANONYMOUS,
  createStoreContext,
  findCategoryBySlug,
  findProductBySlug,
  firestoreSearchPort,
  listFilterCategories,
  listNavCategories,
  listPublishedReviews,
  listVariantOptions,
  systemClock,
} from '@romp/data';
import type { Caller, SearchPort, StoreContext, WithId } from '@romp/data';

import { catalogueAvailable, db, storeId } from './firebase';
import { cacheTags } from './tags';

/**
 * The storefront's read layer.
 *
 * Everything a page needs from the catalogue comes through here, and nothing here is
 * exported to a client component (`import 'server-only'`). The layering is deliberate:
 *
 *  - **`@romp/data`** owns the queries and the ownership filtering.
 *  - **This module** owns *caching* — request-level de-duplication and ISR tagging — and
 *    the anonymous-caller default that makes these reads public.
 *  - **Pages** call these functions and never touch Firestore or the `SearchPort`
 *    directly.
 *
 * The caller is `ANONYMOUS` throughout, and that is the security posture, not a
 * convenience: the storefront is a public surface, so its reads see only what an
 * unauthenticated visitor may see — active products, published reviews, the category
 * tree. A signed-in customer's *own* data (cart, orders) is never read here; that is the
 * account area's job, with a real caller, in a later task.
 */

/**
 * The search adapter this deployment uses.
 *
 * Firestore in production; swappable for the in-memory adapter in a test that sets
 * `__ROMP_TEST_SEARCH_PORT`. Reading the override from a global rather than a parameter
 * keeps the page code identical between test and production — a page calls
 * `searchProducts` the same way regardless — and the override exists only so a listing
 * page renders in jsdom with no emulator.
 */
declare global {
  var __ROMP_TEST_SEARCH_PORT: SearchPort | undefined;
}

function port(): SearchPort {
  return globalThis.__ROMP_TEST_SEARCH_PORT ?? firestoreSearchPort;
}

/**
 * The store context for a public read.
 *
 * `cache()` memoises it for the duration of one request, so a page rendering a header, a
 * rail and a grid builds one context rather than three. The system clock is right here:
 * a storefront read has no reservation TTL to reason about, and nothing in these paths
 * depends on a fixed clock.
 */
const context = cache((): StoreContext =>
  createStoreContext({ storeId: storeId(), db: db(), clock: systemClock }),
);

/** The anonymous caller every public read uses. */
const caller: Caller = ANONYMOUS;

/**
 * Searches products for a listing page.
 *
 * Not wrapped in `unstable_cache`, unlike the reads below — a query with filters, a sort
 * and a cursor has an unbounded key space, so caching it by argument would fill the cache
 * with single-use entries. The listing *page* is cached instead, at the route level, with
 * the tags this module exposes (`cacheTags`), which is the right granularity: one entry
 * per rendered URL, busted by a catalogue write.
 */
export async function searchProducts(query: ProductQuery): Promise<Paged<ProductSummary>> {
  // Empty at build time, where no datastore is reachable. The page renders a shell and
  // ISR fills it on the first request. A test override supplies the in-memory adapter,
  // which is available, so this never short-circuits under test.
  if (globalThis.__ROMP_TEST_SEARCH_PORT === undefined && !catalogueAvailable()) {
    return { items: [], nextCursor: null };
  }
  return port().searchProducts(context(), caller, query);
}

/** Facet counts for a listing sidebar. */
export async function facets(query: ProductQuery): Promise<FacetCounts> {
  if (globalThis.__ROMP_TEST_SEARCH_PORT === undefined && !catalogueAvailable()) {
    return { categories: {}, ageBands: {}, brands: {}, countedDimensions: ['categories'] };
  }
  return port().facets(context(), caller, query);
}

/** Search-box suggestions. */
export async function suggest(prefix: string): Promise<readonly ProductSummary['slug'][]> {
  if (globalThis.__ROMP_TEST_SEARCH_PORT === undefined && !catalogueAvailable()) return [];
  const suggestions = await port().suggest(context(), caller, prefix);
  return suggestions.map((suggestion) => suggestion.slug);
}

/**
 * A product by slug, with its variant options and availability.
 *
 * De-duplicated per request with `cache()`, because the product detail page reads the
 * product for its main content and again for its structured-data and metadata — three
 * reads of the same slug in one render collapse to one.
 *
 * Returns null for a missing or unpublished product, so the page can render a 404 rather
 * than the read throwing.
 */
export const getProduct = cache(
  (
    slug: string,
  ): Promise<{
    readonly product: WithId<ProductDoc>;
    readonly variants: readonly VariantOption[];
  } | null> => {
    if (globalThis.__ROMP_TEST_SEARCH_PORT === undefined && !catalogueAvailable()) {
      return Promise.resolve(null);
    }
    // Tagged with `product:{slug}`, so an edit to this product busts its detail page
    // without touching any other. The per-request `cache()` above collapses the three
    // reads a PDP does of the same slug (content, metadata, structured data) into one.
    return unstable_cache(
      async () => {
        const product = await findProductBySlug(context(), caller, slug);
        if (product === null) return null;

        const variants = await listVariantOptions(context(), caller, product.id);
        return { product, variants };
      },
      ['product', slug],
      { tags: [cacheTags.product(slug), cacheTags.catalogue] },
    )();
  },
);

/**
 * The published reviews for a product, newest first — the PDP review list.
 *
 * Read as `ANONYMOUS`, so it returns only `published` reviews, matching what an unauthenticated
 * visitor may see. The `body` is carried **raw**; it is escaped by React at render and never reaches
 * `dangerouslySetInnerHTML`. Tagged under the product so a product edit refreshes it; a newly
 * published review otherwise appears within the revalidation window (an ISR review list does not need
 * to be instant, and moderation is not a real-time surface).
 */
export const getProductReviews = cache(
  (productId: string, slug: string): Promise<readonly PublicReviewView[]> => {
    if (globalThis.__ROMP_TEST_SEARCH_PORT === undefined && !catalogueAvailable()) {
      return Promise.resolve([]);
    }
    return unstable_cache(
      async () => {
        const reviews = await listPublishedReviews(context(), productId);
        return reviews.map((review) => ({
          id: review.id as PublicReviewView['id'],
          productId: review.productId,
          authorName: review.authorName,
          rating: review.rating,
          title: review.title,
          body: review.body,
          verifiedPurchase: review.verifiedPurchase,
          createdAt: review.createdAt,
        }));
      },
      ['product-reviews', productId],
      { tags: [cacheTags.product(slug), cacheTags.catalogue] },
    )();
  },
);

/**
 * The category tree for the home-page rails (`showInNav`).
 *
 * `unstable_cache` with the `categories` tag, on top of the per-request `cache()`: the
 * per-request layer de-duplicates within one render, and the persistent layer holds the
 * tree across requests until a category change busts the tag (Task 12). The nav is on
 * every page, changes rarely, and reads the whole collection — exactly the read worth
 * caching persistently rather than running per request.
 */
export const getNavCategories = cache(async (): Promise<readonly WithId<CategoryDoc>[]> => {
  if (globalThis.__ROMP_TEST_SEARCH_PORT === undefined && !catalogueAvailable()) return [];
  return unstable_cache(async () => listNavCategories(context()), ['nav-categories'], {
    tags: [cacheTags.categories],
  })();
});

/**
 * Categories flagged for the listing sidebar (`showInFilters`).
 *
 * Same caching posture as the nav tree: the sidebar is on every listing page, the
 * collection is tiny, and a category write busts the `categories` tag.
 */
export const getFilterCategories = cache(async (): Promise<readonly WithId<CategoryDoc>[]> => {
  if (globalThis.__ROMP_TEST_SEARCH_PORT === undefined && !catalogueAvailable()) return [];
  return unstable_cache(async () => listFilterCategories(context()), ['filter-categories'], {
    tags: [cacheTags.categories],
  })();
});

/**
 * One category by slug, for a listing page's heading and metadata.
 *
 * Tagged with both the specific `category:{slug}` and the coarse `categories`, so it is
 * busted whether a single category is renamed or the whole tree is rebuilt. The slug is
 * part of the cache key, so two categories do not share an entry.
 */
export const getCategory = cache((slug: string): Promise<WithId<CategoryDoc> | null> => {
  if (globalThis.__ROMP_TEST_SEARCH_PORT === undefined && !catalogueAvailable()) {
    return Promise.resolve(null);
  }
  return unstable_cache(
    async (): Promise<WithId<CategoryDoc> | null> => findCategoryBySlug(context(), slug),
    ['category', slug],
    { tags: [cacheTags.categories, cacheTags.category(slug)] },
  )();
});

/**
 * A named rail of featured products.
 *
 * Featured is a query, not a stored flag on the summary — `featured: true` in the seed
 * becomes a product whose rail membership the home page asks for. In v1.0 that is served
 * as "the newest few", because there is no dedicated featured index yet and the home
 * page's job is to show *something* fresh above the fold. A real featured curation is a
 * roadmap item; the seam is here so the home page does not change when it lands.
 */
export async function featuredProducts(limit: number): Promise<readonly ProductSummary[]> {
  const page = await searchProducts({ sort: 'newest', limit });
  return page.items;
}

/** The newest products in one category, for a home-page rail. */
export async function categoryRail(
  categorySlug: string,
  limit: number,
): Promise<readonly ProductSummary[]> {
  const page = await searchProducts({ categorySlugs: [categorySlug], sort: 'newest', limit });
  return page.items;
}
