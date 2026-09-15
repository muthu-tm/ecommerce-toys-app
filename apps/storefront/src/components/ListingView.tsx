import type { ProductQuery } from '@romp/contracts';
import { EmptyState, PageHeader } from '@romp/ui';

import { ListingControls } from '@/components/ListingControls';
import { ListingFilters } from '@/components/ListingFilters';
import { Pagination } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import {
  type ListingFixedFilter,
  mergeListingQuery,
  parseListingParams,
  preservedParams,
} from '@/lib/listing';
import { content } from '@/lib/store';
import { facets, getFilterCategories, searchProducts } from '@/server/catalogue';

/**
 * The shared body of every listing page.
 *
 * The category page, the age-band page and search differ only in their heading, their
 * canonical URL and the filter they fix — so the query building, the sidebar, the grid,
 * the empty state and the pagination all live here.
 *
 * A server component: it reads the query, runs the search server-side, and renders the
 * result. The client islands are `ListingControls` (sort) and `ListingFilters` (sidebar
 * / mobile sheet), which write the URL.
 */

export interface ListingViewProps {
  readonly title: string;
  readonly basePath: string;
  readonly searchParams: Readonly<Record<string, string | string[] | undefined>>;
  readonly fixedFilter?: ListingFixedFilter;
}

export async function ListingView({
  title,
  basePath,
  searchParams,
  fixedFilter = {},
}: ListingViewProps) {
  const parsed = parseListingParams(searchParams);
  const query: ProductQuery = mergeListingQuery(parsed, fixedFilter);

  const [page, counts, filterCategories] = await Promise.all([
    searchProducts(query),
    facets(query),
    getFilterCategories(),
  ]);
  const params = preservedParams(parsed);

  const lockedCategory =
    fixedFilter.categorySlugs?.length === 1 ? fixedFilter.categorySlugs[0] : undefined;
  const lockedAge = fixedFilter.ageBands?.length === 1 ? fixedFilter.ageBands[0] : undefined;

  const categoryOptions = filterCategories.map((category) => ({
    slug: category.slug,
    name: category.name,
    count: counts.countedDimensions.includes('categories')
      ? (counts.categories[category.slug] ?? 0)
      : null,
  }));

  const filterProps = {
    selectedCategories: query.categorySlugs ?? [],
    selectedAges: query.ageBands ?? [],
    categories: categoryOptions,
    minPrice: parsed.query.price?.minMinor,
    maxPrice: parsed.query.price?.maxMinor,
    inStockOnly: parsed.inStockOnly,
    ...(lockedCategory === undefined ? {} : { lockedCategory }),
    ...(lockedAge === undefined ? {} : { lockedAge }),
  };

  const hasActiveFilters =
    parsed.inStockOnly ||
    parsed.query.price !== undefined ||
    parsed.categorySlugs.length > 0 ||
    parsed.ageBands.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <ListingFilters {...filterProps} placement="toolbar" />
            <ListingControls sort={parsed.sort} />
          </div>
        }
      />

      <div className="grid items-start gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden lg:block lg:sticky lg:top-24">
          <ListingFilters {...filterProps} placement="sidebar" />
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          {page.items.length === 0 ? (
            <EmptyState
              title={content.emptyStates.noResults.title}
              body={content.emptyStates.noResults.body}
              action={
                hasActiveFilters ? (
                  <a
                    href={basePath}
                    className="font-body text-sm font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    Clear filters
                  </a>
                ) : undefined
              }
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
      </div>
    </div>
  );
}
