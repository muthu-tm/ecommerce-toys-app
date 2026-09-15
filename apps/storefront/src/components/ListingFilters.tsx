'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';

import { formatMoney, money } from '@romp/contracts';
import { Button, Dialog } from '@romp/ui';

import { content, moneyFormat } from '@/lib/store';

/**
 * Listing sidebar (desktop) and filter sheet (mobile).
 *
 * Writes age, category, price and in-stock into the URL. Sort stays in `ListingControls`
 * above the grid — the prototype keeps those two jobs apart. Changing a control drops
 * the cursor, because a cursor is bound to the query that produced it.
 *
 * Category/age values that the *route* already fixes (`/c/wooden`, `/age/6-8`) render
 * selected and are not un-toggled here: leaving the route is a different page, not a
 * query-string edit. Extra categories and ages append as `c` / `age` params.
 *
 * Labels here are UI chrome ("Age", "Price", "In stock only"), not brand voice.
 */

export interface FilterCategory {
  readonly slug: string;
  readonly name: string;
  readonly count: number | null;
}

export interface ListingFiltersProps {
  readonly selectedCategories: readonly string[];
  readonly selectedAges: readonly string[];
  readonly lockedCategory?: string;
  readonly lockedAge?: string;
  readonly categories: readonly FilterCategory[];
  readonly minPrice: number | undefined;
  readonly maxPrice: number | undefined;
  readonly inStockOnly: boolean;
  /**
   * `toolbar` is the mobile Filters button (hidden from `lg` up). `sidebar` is the
   * desktop fieldset column (hidden below `lg`). Both mount the same fields.
   */
  readonly placement: 'toolbar' | 'sidebar';
}

interface PricePreset {
  readonly id: string;
  readonly label: string;
  readonly minMinor: number | undefined;
  readonly maxMinor: number | undefined;
}

const PRICE_PRESETS: readonly PricePreset[] = [
  { id: 'under-500', label: `Under ${formatMoney(money(50_000), moneyFormat)}`, minMinor: undefined, maxMinor: 50_000 },
  { id: '500-1500', label: `${formatMoney(money(50_000), moneyFormat)} – ${formatMoney(money(150_000), moneyFormat)}`, minMinor: 50_000, maxMinor: 150_000 },
  { id: '1500-3000', label: `${formatMoney(money(150_000), moneyFormat)} – ${formatMoney(money(300_000), moneyFormat)}`, minMinor: 150_000, maxMinor: 300_000 },
  { id: 'over-3000', label: `${formatMoney(money(300_000), moneyFormat)}+`, minMinor: 300_000, maxMinor: undefined },
];

function chipClass(active: boolean, locked: boolean): string {
  if (active) {
    return 'rounded-pill bg-primary px-3 py-1.5 font-body text-sm font-semibold text-primary-on';
  }
  if (locked) {
    return 'rounded-pill bg-primary px-3 py-1.5 font-body text-sm font-semibold text-primary-on';
  }
  return 'rounded-pill border border-border px-3 py-1.5 font-body text-sm text-text-secondary hover:bg-surface-alt hover:text-text-primary';
}

export function ListingFilters(props: ListingFiltersProps) {
  const [open, setOpen] = useState(false);

  if (props.placement === 'toolbar') {
    return (
      <div className="lg:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          Filters
        </Button>
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title="Filters"
        >
          <FilterFields {...props} />
        </Dialog>
      </div>
    );
  }

  return (
    <nav aria-label="Filters" className="hidden lg:block">
      <FilterFields {...props} />
    </nav>
  );
}

function FilterFields({
  selectedCategories,
  selectedAges,
  lockedCategory,
  lockedAge,
  categories,
  minPrice,
  maxPrice,
  inStockOnly,
}: ListingFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stockId = useId();

  function navigate(next: URLSearchParams): void {
    next.delete('cursor');
    const queryString = next.toString();
    router.push(queryString === '' ? pathname : `${pathname}?${queryString}`);
  }

  function toggleMulti(key: string, value: string, currentlyOn: boolean): void {
    const next = new URLSearchParams(searchParams.toString());
    const remaining = next.getAll(key).filter((entry) => entry !== value);
    next.delete(key);
    for (const entry of remaining) next.append(key, entry);
    if (!currentlyOn) next.append(key, value);
    navigate(next);
  }

  function setPrice(preset: PricePreset | null): void {
    const next = new URLSearchParams(searchParams.toString());
    if (preset === null) {
      next.delete('minPrice');
      next.delete('maxPrice');
    } else {
      if (preset.minMinor === undefined) next.delete('minPrice');
      else next.set('minPrice', String(preset.minMinor));
      if (preset.maxMinor === undefined) next.delete('maxPrice');
      else next.set('maxPrice', String(preset.maxMinor));
      // Price + rating is unservable; drop the rating sort rather than 500 the page.
      if (next.get('sort') === 'rating_desc') next.delete('sort');
    }
    navigate(next);
  }

  function setInStock(checked: boolean): void {
    const next = new URLSearchParams(searchParams.toString());
    if (checked) next.set('inStock', 'true');
    else next.delete('inStock');
    navigate(next);
  }

  const ageOptions = content.ageBands;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <fieldset>
        <legend className="mb-3 font-body text-xs font-bold tracking-wide text-text-muted uppercase">
          Age
        </legend>
        <div className="flex flex-wrap gap-2">
          {ageOptions.map((band) => {
            const locked = lockedAge === band.value;
            const selected = locked || selectedAges.includes(band.value);
            return (
              <button
                key={band.value}
                type="button"
                aria-pressed={selected}
                disabled={locked}
                className={chipClass(selected, locked)}
                onClick={() => {
                  if (!locked) toggleMulti('age', band.value, selected);
                }}
              >
                {band.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 font-body text-xs font-bold tracking-wide text-text-muted uppercase">
          Price
        </legend>
        <div className="flex flex-wrap gap-2">
          {PRICE_PRESETS.map((preset) => {
            const active = minPrice === preset.minMinor && maxPrice === preset.maxMinor;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                className={chipClass(active, false)}
                onClick={() => {
                  setPrice(active ? null : preset);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {categories.length > 0 ? (
        <fieldset>
          <legend className="mb-3 font-body text-xs font-bold tracking-wide text-text-muted uppercase">
            Category
          </legend>
          <ul className="flex flex-col gap-2">
            {categories.map((category) => {
              const locked = lockedCategory === category.slug;
              const selected = locked || selectedCategories.includes(category.slug);
              const countLabel = category.count === null ? null : ` (${String(category.count)})`;
              return (
                <li key={category.slug}>
                  <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={locked}
                      onChange={() => {
                        if (!locked) toggleMulti('c', category.slug, selected);
                      }}
                      className="h-4 w-4 rounded border-border-strong text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    />
                    <span className={selected ? 'font-semibold text-text-primary' : undefined}>
                      {category.name}
                      {countLabel}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-text-secondary">
        <input
          id={stockId}
          type="checkbox"
          checked={inStockOnly}
          onChange={(event) => {
            setInStock(event.target.checked);
          }}
          className="h-4 w-4 rounded border-border-strong text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
        In stock only
      </label>
    </form>
  );
}
