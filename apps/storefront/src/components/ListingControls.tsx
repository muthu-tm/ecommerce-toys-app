'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId } from 'react';

import type { ProductSort } from '@romp/contracts';

/**
 * The sort dropdown for a listing page.
 *
 * A client island, because it writes to the URL — the sort and the filters live in the
 * query string, so the state is shareable, bookmarkable and survives a reload, and the
 * server component re-renders from the new params.
 *
 * **Changing the sort resets the page.** The `cursor` param is dropped, because a cursor
 * is bound to the sort that produced it. Carrying one across a sort change is exactly
 * the mistake `decodeCursor` rejects.
 *
 * In-stock and the other facets live in `ListingFilters`, matching the prototype: sort
 * sits above the grid, filters in the sidebar / mobile sheet.
 */

export interface ListingControlsProps {
  readonly sort: ProductSort;
}

const SORT_OPTIONS: readonly { readonly value: ProductSort; readonly label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating_desc', label: 'Top rated' },
];

export function ListingControls({ sort }: ListingControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortId = useId();

  function update(sortValue: string): void {
    const next = new URLSearchParams(searchParams.toString());
    if (sortValue === 'newest') next.delete('sort');
    else next.set('sort', sortValue);

    // Price + rating is unservable. Drop the price filter rather than 500 the page.
    if (sortValue === 'rating_desc') {
      next.delete('minPrice');
      next.delete('maxPrice');
    }

    next.delete('cursor');
    const queryString = next.toString();
    router.push(queryString === '' ? pathname : `${pathname}?${queryString}`);
  }

  return (
    <label className="flex items-center gap-2 font-body text-sm text-text-secondary">
      <span id={`${sortId}-label`}>Sort by</span>
      <select
        aria-labelledby={`${sortId}-label`}
        value={sort}
        onChange={(event) => {
          update(event.target.value);
        }}
        className="rounded-md border border-border bg-surface px-3 py-2 font-body text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
