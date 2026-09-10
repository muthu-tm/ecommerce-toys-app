import type { ProductQuery } from '@romp/contracts';

import { EmptyState } from '@/components/EmptyState';
import { ListingControls } from '@/components/ListingControls';
import { Pagination } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { parseListingParams, preservedParams } from '@/lib/listing';
import { content } from '@/lib/store';
import { searchProducts } from '@/server/catalogue';

/**
 * The shared body of every listing page.
 *
 * The category page and the age-band page differ only in their heading, their canonical
 * URL and the one filter they fix — so the query building, the controls, the grid, the
 * empty state and the pagination all live here, and each route is a thin wrapper that
 * supplies the fixed filter and the copy.
 *
 * A server component: it reads the query, runs the search server-side, and renders the
 * result. The only client island inside it is `ListingControls`, which writes the URL.
 */
export interface ListingViewProps {
  /** The page's own heading. */
  readonly title: string;
  /** The route path without query string, for pagination links, e.g. `/c/wooden`. */
  readonly basePath: string;
  /** Search params from the route, already narrowed by the page. */
  readonly searchParams: Readonly<Record<string, string | string[] | undefined>>;
  /**
   * The filter this route fixes — a category or an age band. Merged into the parsed
   * query, so the route decides what is being listed and the shared code decides how.
   */
  readonly fixedFilter: { readonly categorySlugs: string[] } | { readonly ageBands: string[] };
}

export async function ListingView({
  title,
  basePath,
  searchParams,
  fixedFilter,
}: ListingViewProps) {
  const parsed = parseListingParams(searchParams);
  const query: ProductQuery = { ...parsed.query, ...fixedFilter };

  const page = await searchProducts(query);
  const params = preservedParams(parsed);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl text-text-primary">{title}</h1>

      <ListingControls sort={parsed.sort} inStockOnly={parsed.inStockOnly} />

      {page.items.length === 0 ? (
        // Copy from config, so a second store's "no results" reads in its own voice.
        <EmptyState
          title={content.emptyStates.noResults.title}
          body={content.emptyStates.noResults.body}
        />
      ) : (
        <>
          <ProductGrid products={page.items} />
          <Pagination
            basePath={basePath}
            params={params}
            nextCursor={page.nextCursor}
            hasCursor={parsed.query.cursor !== undefined}
          />
        </>
      )}
    </div>
  );
}
