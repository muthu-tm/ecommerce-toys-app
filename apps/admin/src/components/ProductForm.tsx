'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field } from '@romp/ui';

import { ApiError, adminApi } from '@/lib/api';
import type { ProductFormState } from '@/lib/product-form';
import { EMPTY_PRODUCT_FORM, toCreateRequest, toUpdateRequest } from '@/lib/product-form';

/**
 * The product create / edit form.
 *
 * A client component driven by the pure `product-form.ts` mapping: it holds the string state
 * the inputs produce and, on submit, maps it to the API request. The mapping — splitting
 * lists, the safety block, the SEO fields — is tested there; this is the binding and the
 * submit lifecycle. The form is split into a **Details** tab and an **SEO** tab, the SEO tab
 * being slug/title/description/index overrides, so a product's search presentation is edited
 * in one place.
 *
 * On create it navigates to the new product's edit page (where variants and media are added);
 * on edit it refreshes. A failed write shows the API's own message.
 */

type Tab = 'details' | 'seo';

export interface ProductFormProps {
  /** Present on the edit page; absent on create. */
  readonly productId?: string;
  readonly initial?: ProductFormState;
  readonly categories: readonly {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  }[];
}

export function ProductForm({ productId, initial, categories }: ProductFormProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('details');
  const [state, setState] = useState<ProductFormState>(initial ?? EMPTY_PRODUCT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = productId !== undefined;

  const set = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]): void => {
    setState((current) => ({ ...current, [key]: value }));
  };

  const submit = (): void => {
    setSaving(true);
    setError(null);

    const done = (): void => {
      setSaving(false);
    };
    const fail = (cause: unknown): void => {
      setError(cause instanceof ApiError ? cause.message : 'Could not save the product.');
      setSaving(false);
    };

    if (isEdit) {
      void adminApi
        .updateProduct(productId, toUpdateRequest(state))
        .then(() => {
          router.refresh();
          done();
        })
        .catch(fail);
    } else {
      void adminApi
        .createProduct(toCreateRequest(state))
        .then((created) => {
          router.push(`/products/${created.id}`);
        })
        .catch(fail);
    }
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div
        role="tablist"
        aria-label="Product form sections"
        className="flex gap-2 border-b border-border"
      >
        <TabButton
          active={tab === 'details'}
          onClick={() => {
            setTab('details');
          }}
        >
          Details
        </TabButton>
        <TabButton
          active={tab === 'seo'}
          onClick={() => {
            setTab('seo');
          }}
        >
          SEO
        </TabButton>
      </div>

      {tab === 'details' ? (
        <div className="flex flex-col gap-4">
          <Field
            label="Name"
            required
            value={state.name}
            onChange={(event) => {
              set('name', event.target.value);
            }}
          />
          <Field
            label="Slug"
            hint="Leave blank to derive it from the name."
            value={state.slug}
            disabled={isEdit}
            onChange={(event) => {
              set('slug', event.target.value);
            }}
          />
          <Field
            label="Description"
            required
            value={state.description}
            onChange={(event) => {
              set('description', event.target.value);
            }}
          />
          <Field
            label="Brand"
            required
            value={state.brand}
            onChange={(event) => {
              set('brand', event.target.value);
            }}
          />
          <label className="flex flex-col gap-1.5">
            <span className="font-body text-sm font-semibold text-text-primary">Category</span>
            <select
              className="min-h-11 rounded-md border border-border-strong bg-surface px-3 font-body text-base text-text-primary"
              value={state.categoryId}
              onChange={(event) => {
                const chosen = categories.find((category) => category.id === event.target.value);
                setState((current) => ({
                  ...current,
                  categoryId: event.target.value,
                  categorySlug: chosen?.slug ?? '',
                }));
              }}
            >
              <option value="">Select a category…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Age band"
            required
            hint="For example, 6-8 or 8+."
            value={state.ageBand}
            onChange={(event) => {
              set('ageBand', event.target.value);
            }}
          />
          <Field
            label="Badge"
            hint="An optional ribbon, e.g. Bestseller."
            value={state.badge}
            onChange={(event) => {
              set('badge', event.target.value);
            }}
          />
          <Field
            label="Skills it builds"
            hint="Comma-separated."
            value={state.skills}
            onChange={(event) => {
              set('skills', event.target.value);
            }}
          />
          <Field
            label="In the box"
            hint="Comma-separated."
            value={state.boxItems}
            onChange={(event) => {
              set('boxItems', event.target.value);
            }}
          />

          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
            <legend className="px-1 font-body text-sm font-semibold text-text-primary">
              Safety
            </legend>
            <Checkbox
              label="BIS certified"
              checked={state.bisCertified}
              onChange={(checked) => {
                set('bisCertified', checked);
              }}
            />
            {state.bisCertified ? (
              <>
                <Field
                  label="BIS certificate number"
                  value={state.bisCertNo}
                  onChange={(event) => {
                    set('bisCertNo', event.target.value);
                  }}
                />
                <Field
                  label="BIS certificate expiry"
                  type="date"
                  value={state.bisCertExpiry}
                  onChange={(event) => {
                    set('bisCertExpiry', event.target.value);
                  }}
                />
              </>
            ) : null}
            <Checkbox
              label="BPA free"
              checked={state.bpaFree}
              onChange={(checked) => {
                set('bpaFree', checked);
              }}
            />
            <Checkbox
              label="Contains small parts"
              checked={state.hasSmallParts}
              onChange={(checked) => {
                set('hasSmallParts', checked);
              }}
            />
          </fieldset>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field
            label="SEO title"
            hint="Overrides the page title. Leave blank to use the product name."
            value={state.seoTitle}
            onChange={(event) => {
              set('seoTitle', event.target.value);
            }}
          />
          <Field
            label="SEO description"
            hint="Overrides the meta description. Leave blank to use the product description."
            value={state.seoDescription}
            onChange={(event) => {
              set('seoDescription', event.target.value);
            }}
          />
          <Checkbox
            label="Allow search engines to index this product"
            checked={state.seoIndex}
            onChange={(checked) => {
              set('seoIndex', checked);
            }}
          />
        </div>
      )}

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={saving}>
          {isEdit ? 'Save changes' : 'Create product'}
        </Button>
      </div>
    </form>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 font-body text-sm font-semibold ${
        active ? 'border-accent text-text-primary' : 'border-transparent text-text-muted'
      }`}
    >
      {children}
    </button>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 font-body text-sm text-text-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="size-4"
      />
      {label}
    </label>
  );
}
