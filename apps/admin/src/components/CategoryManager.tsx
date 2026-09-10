'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CategoryDoc } from '@romp/contracts';
import type { WithId } from '@romp/data';
import { Badge, Button, Field } from '@romp/ui';

import { ApiError, adminApi } from '@/lib/api';
import {
  EMPTY_CATEGORY_FORM,
  buildCategoryTree,
  categoryDocToFormState,
  toCreateCategoryRequest,
  toUpdateCategoryRequest,
} from '@/lib/category-form';
import type { CategoryFormState } from '@/lib/category-form';

/**
 * The backoffice category manager.
 *
 * Shows the category tree — top-level categories with their children — each row carrying its
 * facet count and its active/visibility state, with controls to toggle activation, delete (the
 * API refuses while products or children depend on it), and reorder within a level. A create
 * form adds a category: a name, an optional slug, an optional parent, and the flags. Every
 * mutation goes through the API and refreshes the route so the tree reflects the change.
 *
 * The copy here is plain backoffice language — an operator tool, not a storefront surface — so
 * there is nothing store-specific to configure. The tree-building and the request mapping are
 * pure and tested in `category-form.ts`; this is the binding and the submit lifecycle.
 */
export function CategoryManager({
  categories,
}: {
  readonly categories: readonly WithId<CategoryDoc>[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<CategoryFormState>(EMPTY_CATEGORY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tree = buildCategoryTree(categories);
  const topLevel = categories.filter((category) => category.parentId === null);

  const set = <K extends keyof CategoryFormState>(key: K, value: CategoryFormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const run = (action: Promise<unknown>, fallback: string): void => {
    setSaving(true);
    setError(null);
    void action
      .then(() => {
        router.refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : fallback);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const create = (): void => {
    if (form.name.trim() === '') {
      setError('A category needs a name.');
      return;
    }
    run(
      adminApi.createCategory(toCreateCategoryRequest(form)).then(() => {
        setForm(EMPTY_CATEGORY_FORM);
      }),
      'Could not create the category.',
    );
  };

  const toggleActive = (category: WithId<CategoryDoc>): void => {
    // Route through the tested mapper (which handles the branded parent slug) rather than
    // assembling the update body inline, flipping only `active`.
    const body = toUpdateCategoryRequest({
      ...categoryDocToFormState(category),
      active: !category.active,
    });
    run(adminApi.updateCategory(category.slug, body), 'Could not update the category.');
  };

  const remove = (category: WithId<CategoryDoc>): void => {
    run(adminApi.deleteCategory(category.slug), 'Could not delete the category.');
  };

  /** Swaps a category's sortOrder with its neighbour in the same level. */
  const move = (
    siblings: readonly WithId<CategoryDoc>[],
    index: number,
    direction: -1 | 1,
  ): void => {
    const target = siblings[index];
    const swapWith = siblings[index + direction];
    if (target === undefined || swapWith === undefined) return;
    run(
      adminApi.reorderCategories({
        orders: [
          { slug: target.slug, sortOrder: swapWith.sortOrder },
          { slug: swapWith.slug, sortOrder: target.sortOrder },
        ],
      }),
      'Could not reorder the categories.',
    );
  };

  return (
    <section aria-labelledby="categories-heading" className="flex flex-col gap-6">
      <h1 id="categories-heading" className="font-display text-2xl text-text-primary">
        Categories
      </h1>

      {categories.length === 0 ? (
        <p className="font-body text-sm text-text-muted">
          No categories yet. Create one to start building the navigation tree.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tree.map((node, index) => (
            <li key={node.category.id} className="flex flex-col gap-2">
              <CategoryRow
                category={node.category}
                siblings={topLevel}
                index={index}
                saving={saving}
                onToggleActive={toggleActive}
                onDelete={remove}
                onMove={move}
              />
              {node.children.length > 0 ? (
                <ul className="ml-6 flex flex-col gap-2">
                  {node.children.map((child, childIndex) => (
                    <li key={child.id}>
                      <CategoryRow
                        category={child}
                        siblings={node.children}
                        index={childIndex}
                        saving={saving}
                        onToggleActive={toggleActive}
                        onDelete={remove}
                        onMove={move}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <h2 className="font-body text-sm font-semibold text-text-primary">Add a category</h2>

        <Field
          label="Name"
          value={form.name}
          onChange={(event) => {
            set('name', event.target.value);
          }}
        />
        <Field
          label="Slug"
          hint="Leave blank to derive it from the name."
          value={form.slug}
          onChange={(event) => {
            set('slug', event.target.value);
          }}
        />

        <label className="flex flex-col gap-1.5">
          <span className="font-body text-sm font-semibold text-text-primary">Parent</span>
          <select
            className="min-h-11 rounded-md border border-border-strong bg-surface px-3 font-body text-base text-text-primary"
            value={form.parentId}
            onChange={(event) => {
              set('parentId', event.target.value);
            }}
          >
            <option value="">Top level (no parent)</option>
            {topLevel.map((category) => (
              <option key={category.id} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <Field
          label="Sort order"
          inputMode="numeric"
          value={form.sortOrder}
          onChange={(event) => {
            set('sortOrder', event.target.value);
          }}
        />

        <CheckboxField
          label="Active"
          checked={form.active}
          onChange={(checked) => {
            set('active', checked);
          }}
        />
        <CheckboxField
          label="Show in navigation"
          checked={form.showInNav}
          onChange={(checked) => {
            set('showInNav', checked);
          }}
        />
        <CheckboxField
          label="Show in filters"
          checked={form.showInFilters}
          onChange={(checked) => {
            set('showInFilters', checked);
          }}
        />

        {error !== null ? (
          <p role="alert" className="font-body text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div>
          <Button type="button" loading={saving} onClick={create}>
            Add category
          </Button>
        </div>
      </div>
    </section>
  );
}

function CategoryRow({
  category,
  siblings,
  index,
  saving,
  onToggleActive,
  onDelete,
  onMove,
}: {
  readonly category: WithId<CategoryDoc>;
  readonly siblings: readonly WithId<CategoryDoc>[];
  readonly index: number;
  readonly saving: boolean;
  readonly onToggleActive: (category: WithId<CategoryDoc>) => void;
  readonly onDelete: (category: WithId<CategoryDoc>) => void;
  readonly onMove: (
    siblings: readonly WithId<CategoryDoc>[],
    index: number,
    direction: -1 | 1,
  ) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-2">
      <span className="flex flex-col">
        <span className="font-body font-semibold text-text-primary">{category.name}</span>
        <span className="font-body text-sm text-text-muted">
          {category.slug} · {category.productCount} product{category.productCount === 1 ? '' : 's'}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <Badge tone={category.active ? 'success' : 'neutral'}>
          {category.active ? 'Active' : 'Inactive'}
        </Badge>
        <Button
          type="button"
          variant="outline"
          disabled={saving || index === 0}
          onClick={() => {
            onMove(siblings, index, -1);
          }}
          aria-label={`Move ${category.name} up`}
        >
          ↑
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving || index === siblings.length - 1}
          onClick={() => {
            onMove(siblings, index, 1);
          }}
          aria-label={`Move ${category.name} down`}
        >
          ↓
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => {
            onToggleActive(category);
          }}
        >
          {category.active ? 'Deactivate' : 'Activate'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => {
            onDelete(category);
          }}
        >
          Delete
        </Button>
      </span>
    </div>
  );
}

function CheckboxField({
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
