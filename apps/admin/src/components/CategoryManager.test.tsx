import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryDoc } from '@romp/contracts';
import { aCategory } from '@romp/contracts/fixtures';
import type { WithId } from '@romp/data';

/**
 * The category manager lists the tree and mutates it through the API. The concern here is what
 * the component decides and dispatches: it renders parents with their children, creates a
 * category from the form, toggles activation, deletes, and reorders siblings by swapping sort
 * orders. The tree-building and request mapping are pure (tested in category-form.test.ts); the
 * transactions are covered against the emulator.
 */

const createCategory = vi.hoisted(() => vi.fn(() => Promise.resolve({ id: 'new', slug: 'new' })));
const updateCategory = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const reorderCategories = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const deleteCategory = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  adminApi: { createCategory, updateCategory, reorderCategories, deleteCategory },
  // Mirror the real ApiError shape (status, code, detail) so `.message` is the detail.
  ApiError: class ApiError extends Error {
    constructor(_status: number, _code: string, detail: string) {
      super(detail);
    }
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const { CategoryManager } = await import('./CategoryManager');

function category(overrides: Partial<CategoryDoc> & { id: string }): WithId<CategoryDoc> {
  const { id, ...rest } = overrides;
  return { ...aCategory(rest), id };
}

const TREE: readonly WithId<CategoryDoc>[] = [
  category({
    id: 'wooden',
    slug: 'wooden' as CategoryDoc['slug'],
    name: 'Wooden toys',
    parentId: null,
    sortOrder: 10,
    productCount: 3,
  }),
  category({
    id: 'puzzles',
    slug: 'puzzles' as CategoryDoc['slug'],
    name: 'Puzzles',
    parentId: null,
    sortOrder: 20,
    productCount: 0,
  }),
  category({
    id: 'sensory',
    slug: 'sensory' as CategoryDoc['slug'],
    name: 'Sensory',
    parentId: 'wooden' as CategoryDoc['parentId'],
    sortOrder: 11,
    active: false,
    productCount: 1,
  }),
];

beforeEach(() => {
  createCategory.mockClear();
  updateCategory.mockClear();
  reorderCategories.mockClear();
  deleteCategory.mockClear();
  refresh.mockClear();
});

describe('CategoryManager', () => {
  it('renders parents with their children and facet counts', () => {
    render(<CategoryManager categories={TREE} />);
    // "Sensory" is a leaf (not a parent option in the select), so it is unique. The facet
    // counts and the inactive badge are the unambiguous assertions.
    expect(screen.getByText('Sensory')).toBeInTheDocument();
    expect(screen.getByText(/wooden · 3 products/u)).toBeInTheDocument();
    expect(screen.getByText(/sensory · 1 product$/u)).toBeInTheDocument();
    // Sensory is inactive.
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('creates a category from the form, omitting an empty slug', async () => {
    const user = userEvent.setup();
    render(<CategoryManager categories={[]} />);

    await user.type(screen.getByLabelText(/^Name/u), 'Outdoor');
    await user.click(screen.getByRole('button', { name: 'Add category' }));

    await waitFor(() => {
      expect(createCategory).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Outdoor', parentId: null }),
      );
    });
    // No pinned slug was entered, so none is sent.
    const calls = createCategory.mock.calls as unknown as Record<string, unknown>[][];
    const body = calls[0]?.[0];
    expect(body !== undefined && 'slug' in body).toBe(false);
  });

  it('does not call the API when the name is blank', async () => {
    const user = userEvent.setup();
    render(<CategoryManager categories={[]} />);
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    expect(screen.getByText(/needs a name/u)).toBeInTheDocument();
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('toggles a category active state through the API', async () => {
    const user = userEvent.setup();
    render(<CategoryManager categories={TREE} />);

    // Sensory is inactive → its button reads "Activate".
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    await waitFor(() => {
      expect(updateCategory).toHaveBeenCalledWith(
        'sensory',
        expect.objectContaining({ active: true }),
      );
    });
  });

  it('deletes a category through the API', async () => {
    const user = userEvent.setup();
    render(
      <CategoryManager
        categories={[
          category({
            id: 'puzzles',
            slug: 'puzzles' as CategoryDoc['slug'],
            name: 'Puzzles',
            parentId: null,
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteCategory).toHaveBeenCalledWith('puzzles');
    });
  });

  it('reorders two top-level categories by swapping their sort orders', async () => {
    const user = userEvent.setup();
    render(<CategoryManager categories={TREE} />);

    // Move "Puzzles" (second, sortOrder 20) up past "Wooden toys" (sortOrder 10).
    await user.click(screen.getByRole('button', { name: 'Move Puzzles up' }));

    await waitFor(() => {
      expect(reorderCategories).toHaveBeenCalledWith({
        orders: [
          { slug: 'puzzles', sortOrder: 10 },
          { slug: 'wooden', sortOrder: 20 },
        ],
      });
    });
  });

  it('shows the API error message when a delete is refused', async () => {
    const { ApiError } = await import('@/lib/api');
    deleteCategory.mockRejectedValueOnce(
      new ApiError(409, 'INVALID_STATE_TRANSITION', 'Category still has products.'),
    );
    const user = userEvent.setup();
    render(
      <CategoryManager
        categories={[
          category({
            id: 'wooden',
            slug: 'wooden' as CategoryDoc['slug'],
            name: 'Wooden toys',
            parentId: null,
            productCount: 3,
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByText(/still has products/u)).toBeInTheDocument();
    });
  });
});
