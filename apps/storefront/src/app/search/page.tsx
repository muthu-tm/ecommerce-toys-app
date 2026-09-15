import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ListingView } from '@/components/ListingView';
import { ProductGridSkeleton } from '@/components/ProductGrid';

/**
 * Prefix search: `/search?q=`.
 *
 * The header form posts here. The query string is the same listing contract as
 * `/c/[slug]` — sort, filters and pagination all apply, with `q` becoming
 * `ProductQuery.text`. Typo-tolerant search is a roadmap item; v1.0 is a prefix
 * match on normalised tokens.
 */

export const revalidate = 3600;

interface SearchPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const q = first((await searchParams).q)?.trim();
  return { title: q !== undefined && q !== '' ? q : 'Search' };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolved = await searchParams;
  const q = first(resolved.q)?.trim();
  const title = q !== undefined && q !== '' ? `Results for "${q}"` : 'Search';

  return (
    <Suspense fallback={<ProductGridSkeleton />}>
      <ListingView title={title} basePath="/search" searchParams={resolved} />
    </Suspense>
  );
}
