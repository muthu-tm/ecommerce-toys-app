'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId } from 'react';

import type { ProductSort } from '@romp/contracts';

/**
 * The sort dropdown and the in-stock toggle for a listing page.
 *
 * A client island, because it writes to the URL — the sort and the filters live in the
 * query string, so the state is shareable, bookmarkable and survives a reload, and the
 * server component re-renders from the new params. Keeping listing state in the URL
 * rather than in component state is what makes a listing page cacheable per URL at all.
 *
 * **Changing a control resets the page.** The `cursor` param is dropped on every change,
 * because a cursor is bound to its sort (it encodes the sort it was issued for) — carrying
 * it across a sort change is exactly the mistake `decodeCursor` rejects, and dropping it
 * here means the customer never sees that error. They go back to page one, which is what
 * they expect when they re-sort.
 *
 * The labels are the only strings here, and they are UI chrome ("Sort by", "In stock
 * only") rather than brand copy — the same in every store, like "Search" or "Menu". A
 * store that needed to translate them would pass them in; none does in v1.0.
 */
export interface ListingControlsProps {
  readonly sort: ProductSort;
  readonly inStockOnly: boolean;
}

const SORT_OPTIONS: readonly { readonly value: ProductSort; readonly label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating_desc', label: 'Top rated' },
];

export function ListingControls({ sort, inStockOnly }: ListingControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortId = useId();
  const stockId = useId();

  /** Writes one param and resets pagination, then navigates. */
  function update(changes: Readonly<Record<string, string | null>>): void {
    const next = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }

    // Always reset the page: a cursor belongs to the sort and filters that produced it.
    next.delete('cursor');

    const queryString = next.toString();
    router.push(queryString === '' ? pathname : `${pathname}?${queryString}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <label className="flex items-center gap-2 font-body text-sm text-text-secondary">
        <span id={`${sortId}-label`}>Sort by</span>
        <select
          aria-labelledby={`${sortId}-label`}
          value={sort}
          onChange={(event) => {
            update({ sort: event.target.value });
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

      <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-secondary">
        <input
          id={stockId}
          type="checkbox"
          checked={inStockOnly}
          onChange={(event) => {
            // A boolean filter lives as a param that is present or absent, not `=false` —
            // an absent param is the default, which keeps the URL clean when nothing is
            // filtered.
            update({ inStock: event.target.checked ? 'true' : null });
          }}
          className="h-4 w-4 rounded border-border-strong text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
        In stock only
      </label>
    </div>
  );
}
