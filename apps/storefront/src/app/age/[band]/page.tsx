import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ListingView } from '@/components/ListingView';
import { ProductGridSkeleton } from '@/components/ProductGrid';
import { content } from '@/lib/store';

/**
 * An age-band listing page: `/age/{band}`.
 *
 * The age taxonomy is store configuration, not a hardcoded set (ADR-0005), so this page
 * validates the band against `content.ageBands` rather than against a union. A band the
 * store does not have is a 404 — the same treatment as an unknown category, so a guessed
 * or retired band does not render an empty listing that looks stocked-out.
 *
 * `generateStaticParams` pre-renders every configured band at build, because the set is
 * small, fixed per store, and linked from the home page — these are the pages worth having
 * warm on first visit.
 */

export const revalidate = 3600;

interface AgePageProps {
  readonly params: Promise<{ readonly band: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export function generateStaticParams(): { readonly band: string }[] {
  return content.ageBands.map((band) => ({ band: band.value }));
}

/** The configured band, or undefined if the value is not one this store defines. */
function findBand(value: string): (typeof content.ageBands)[number] | undefined {
  return content.ageBands.find((band) => band.value === value);
}

export async function generateMetadata({ params }: AgePageProps): Promise<Metadata> {
  const { band } = await params;
  const configured = findBand(band);
  return { title: configured?.label ?? 'Age' };
}

export default async function AgePage({ params, searchParams }: AgePageProps) {
  const { band } = await params;
  const resolvedSearchParams = await searchParams;

  const configured = findBand(band);
  if (configured === undefined) notFound();

  return (
    <Suspense fallback={<ProductGridSkeleton />}>
      <ListingView
        title={configured.label}
        basePath={`/age/${configured.value}`}
        searchParams={resolvedSearchParams}
        fixedFilter={{ ageBands: [configured.value] }}
      />
    </Suspense>
  );
}
