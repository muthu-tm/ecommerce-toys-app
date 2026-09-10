import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ListingView } from '@/components/ListingView';
import { ProductGridSkeleton } from '@/components/ProductGrid';
import { content } from '@/lib/store';
import { getCategory } from '@/server/catalogue';

/**
 * A category listing page: `/c/{slug}`.
 *
 * Statically rendered per category and revalidated by tag — a product entering or leaving
 * the category busts `category:{slug}` (Task 12). The `[slug]` params vary, so this is an
 * on-demand static page rather than one pre-rendered at build; the first request warms it,
 * every later one is cached.
 *
 * `/c/all` is a reserved slug for "everything", handled without a category document, so
 * the home page's "see all" and a top-level "browse everything" both land somewhere real.
 */

export const revalidate = 3600;

const ALL_SLUG = 'all';

interface CategoryPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (slug === ALL_SLUG) {
    return { title: content.home.categorySectionTitle };
  }

  const category = await getCategory(slug);
  // A missing category still needs metadata; the page itself renders the 404.
  return { title: category?.name ?? 'Category' };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;

  if (slug === ALL_SLUG) {
    return (
      <Suspense fallback={<ProductGridSkeleton />}>
        <ListingView
          title={content.home.categorySectionTitle}
          basePath="/c/all"
          searchParams={resolvedSearchParams}
          // No fixed filter: "all" is the whole active catalogue. An empty array reads as
          // "no category filter", not `in []` — the adapter treats it that way.
          fixedFilter={{ categorySlugs: [] }}
        />
      </Suspense>
    );
  }

  const category = await getCategory(slug);
  // 404 for an unknown slug, so a mistyped or retired category is a clean not-found rather
  // than an empty listing that looks like the category exists but is out of stock.
  if (category === null) notFound();

  return (
    <Suspense fallback={<ProductGridSkeleton />}>
      <ListingView
        title={category.name}
        basePath={`/c/${category.slug}`}
        searchParams={resolvedSearchParams}
        fixedFilter={{ categorySlugs: [category.slug] }}
      />
    </Suspense>
  );
}
