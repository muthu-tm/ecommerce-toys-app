'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { VariantDoc } from '@romp/contracts';
import type { WithId } from '@romp/data';
import { Badge, Button, Field } from '@romp/ui';

import { ApiError, adminApi } from '@/lib/api';
import type { VariantFormState } from '@/lib/product-form';
import { toVariantRequest } from '@/lib/product-form';
import { formatMoney, moneyFormat } from '@/lib/store';

/**
 * The variant editor for a product's edit page.
 *
 * Lists the current variants — including inactive ones, which staff must see to reactivate —
 * and offers a form to add another. A variant write refreshes the product's denormalised
 * summary server-side, so adding a cheaper variant moves the product's "from" price with no
 * separate step; this component just refreshes the route to show it. Prices are entered in
 * rupees and converted to paise by `toVariantRequest`, which reports the first invalid field
 * rather than sending a bad number.
 */

const EMPTY_VARIANT: VariantFormState = {
  name: '',
  sku: '',
  price: '',
  mrp: '',
  weightGrams: '',
  active: true,
};

export function VariantEditor({
  productId,
  variants,
}: {
  readonly productId: string;
  readonly variants: readonly WithId<VariantDoc>[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<VariantFormState>(EMPTY_VARIANT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = (): void => {
    const mapped = toVariantRequest(form);
    if (!mapped.ok) {
      setError(`Check the ${mapped.field} field.`);
      return;
    }
    setSaving(true);
    setError(null);
    void adminApi
      .createVariant(productId, mapped.request)
      .then(() => {
        setForm(EMPTY_VARIANT);
        router.refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'Could not add the variant.');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const set = <K extends keyof VariantFormState>(key: K, value: VariantFormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <section aria-labelledby="variants-heading" className="flex flex-col gap-4">
      <h2 id="variants-heading" className="font-display text-xl text-text-primary">
        Variants
      </h2>

      {variants.length === 0 ? (
        <p className="font-body text-sm text-text-muted">
          No variants yet. A product needs at least one active variant before it can be published.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {variants.map((variant) => (
            <li
              key={variant.id}
              className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-2"
            >
              <span className="flex flex-col">
                <span className="font-body font-semibold text-text-primary">{variant.name}</span>
                <span className="font-body text-sm text-text-muted">{variant.sku}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-body text-sm text-text-primary">
                  {formatMoney(variant.priceMinor, moneyFormat)}
                </span>
                <Badge tone={variant.active ? 'success' : 'neutral'}>
                  {variant.active ? 'Active' : 'Inactive'}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <h3 className="font-body text-sm font-semibold text-text-primary">Add a variant</h3>
        <Field
          label="Name"
          value={form.name}
          onChange={(event) => {
            set('name', event.target.value);
          }}
        />
        <Field
          label="SKU"
          value={form.sku}
          onChange={(event) => {
            set('sku', event.target.value);
          }}
        />
        <Field
          label="Price (₹)"
          inputMode="decimal"
          value={form.price}
          onChange={(event) => {
            set('price', event.target.value);
          }}
        />
        <Field
          label="MRP (₹)"
          inputMode="decimal"
          value={form.mrp}
          onChange={(event) => {
            set('mrp', event.target.value);
          }}
        />
        <Field
          label="Weight (grams)"
          inputMode="numeric"
          value={form.weightGrams}
          onChange={(event) => {
            set('weightGrams', event.target.value);
          }}
        />
        {error !== null ? (
          <p role="alert" className="font-body text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="button" loading={saving} onClick={add}>
            Add variant
          </Button>
        </div>
      </div>
    </section>
  );
}
