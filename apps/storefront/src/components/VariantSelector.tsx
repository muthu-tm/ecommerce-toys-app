'use client';

import { useState } from 'react';

import type { VariantOption } from '@romp/contracts';
import { formatMoney } from '@romp/contracts';
import { Badge, cn } from '@romp/ui';

import { AddToCartButton } from './AddToCartButton';

/**
 * Variant selection, price and availability — the buy box.
 *
 * A client island, because the selected variant is state and it drives three things at
 * once: the displayed price, the availability line and whether the add-to-cart button is
 * live. Deriving all three from one `selected` index is what keeps them from disagreeing —
 * a price for one variant beside an "out of stock" for another is the classic buy-box bug.
 *
 * Only *active* variants are offered. An inactive variant still resolves (an old order can
 * reprint), but it is not something a customer can pick, so it never appears here.
 *
 * Availability is a boolean, never a count: the `VariantOption` carries `inStock` only,
 * because the exact number is staff-only and, more honestly, changes between this render
 * and checkout. Out of stock replaces the add button with a disabled state and a word, so
 * the state reaches a screen reader and someone who cannot see the muted styling.
 *
 * Add to cart is wired in Task 15. Until then the button is a real, correctly-labelled
 * control that does nothing on click — the affordance and its states ship now so the
 * layout and the accessibility are settled before the behaviour lands.
 */
export interface VariantSelectorProps {
  /** The product the variants belong to — the cart write addresses the variant by both. */
  readonly productId: string;
  readonly variants: readonly VariantOption[];
  /** The buy-box copy, from store config. */
  readonly labels: {
    readonly selectVariant: string;
    readonly addToCart: string;
    readonly outOfStock: string;
  };
  /** Locale and currency for price formatting, from store config. */
  readonly moneyFormat: { readonly locale: string; readonly currency: string };
}

export function VariantSelector({
  productId,
  variants,
  labels,
  moneyFormat,
}: VariantSelectorProps) {
  const options = variants.filter((variant) => variant.active);
  const [selectedId, setSelectedId] = useState<string | null>(options[0]?.id ?? null);

  const selected = options.find((variant) => variant.id === selectedId) ?? options[0] ?? null;

  // No selectable variant at all — an active product always has one (the schema enforces
  // it), but a defensive empty state beats a crash if that invariant is ever violated.
  if (selected === null) {
    return <p className="font-body text-text-muted">{labels.outOfStock}</p>;
  }

  const hasDiscount = selected.mrpMinor > selected.priceMinor;
  const savingsPercent = hasDiscount
    ? Math.round(((selected.mrpMinor - selected.priceMinor) / selected.mrpMinor) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-body text-3xl font-bold text-text-primary">
          {formatMoney(selected.priceMinor, moneyFormat)}
        </span>
        {hasDiscount && (
          <>
            <span className="font-body text-lg text-text-muted line-through">
              {formatMoney(selected.mrpMinor, moneyFormat)}
            </span>
            {savingsPercent > 0 && (
              <Badge tone="accent">{`Save ${String(savingsPercent)}%`}</Badge>
            )}
          </>
        )}
      </div>

      {options.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-body text-sm font-semibold text-text-primary">
            {labels.selectVariant}
          </legend>
          <div className="flex flex-wrap gap-2">
            {options.map((variant) => {
              const isSelected = variant.id === selected.id;
              return (
                <label
                  key={variant.id}
                  className={cn(
                    'cursor-pointer rounded-md border px-3 py-2 font-body text-sm',
                    'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring',
                    isSelected
                      ? 'border-border-strong bg-surface-alt text-text-primary'
                      : 'border-border text-text-muted hover:border-border-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="variant"
                    value={variant.id}
                    checked={isSelected}
                    onChange={() => {
                      setSelectedId(variant.id);
                    }}
                    className="sr-only"
                  />
                  {variant.name}
                  {!variant.inStock && (
                    <span className="ml-1 text-text-muted">· {labels.outOfStock}</span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <AddToCartButton
        productId={productId}
        variantId={selected.id}
        inStock={selected.inStock}
        label={labels.addToCart}
      />
      {!selected.inStock ? (
        <p className="font-body text-sm text-text-muted">
          <Badge tone="neutral">{labels.outOfStock}</Badge>
        </p>
      ) : null}
    </div>
  );
}
