import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { aCategory, aProduct } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  CategoryHasChildrenError,
  CategoryHasProductsError,
  CategoryNotFoundError,
  CategorySlugTakenError,
  IllegalCategoryParentError,
  applyProductCountDeltas,
  asOperator,
  converters,
  createCategory,
  createStoreContext,
  deleteCategory,
  findCategoryBySlug,
  listCategories,
  reconcileCategoryCount,
  reorderCategories,
  systemClock,
  updateCategory,
} from '@romp/data';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The category write paths against real Firestore.
 *
 * `@romp/core` unit-tests the tree arithmetic and the data package unit-tests the staff gate;
 * this proves the transactional behaviour a real database shows: slug uniqueness via a
 * create-only write, parent validation against the live tree, the reorder batch, and the delete
 * refusals when products or children still depend on a category.
 */

let app: App;
let ctx: StoreContext;
const STAFF = asOperator('staff-1', 'staff');

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `category-write-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

/** A unique slug per test so the shared emulator instance does not cross-contaminate. */
const uniqueSlug = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

const createInput = (slug: string, overrides: Record<string, unknown> = {}) => ({
  name: `Category ${slug}`,
  slug,
  parentId: null,
  active: true,
  showInNav: true,
  showInFilters: true,
  sortOrder: 10,
  ...overrides,
});

/** A product fixture filed under a category slug, for reconcile tests. */
function aProductFixture(categorySlug: string, status: string) {
  return aProduct({
    categorySlug: categorySlug as ReturnType<typeof aProduct>['categorySlug'],
    status: status as ReturnType<typeof aProduct>['status'],
  });
}

/** Seeds a category directly, so a parent or a delete-guard has something to read. */
async function seedCategory(slug: string, overrides = {}): Promise<void> {
  await ctx.db
    .doc(`categories/${slug}`)
    .withConverter(converters.categories)
    .set(aCategory({ slug: slug as ReturnType<typeof aCategory>['slug'], ...overrides }));
}

describe('createCategory', () => {
  it('creates a top-level category with productCount seeded to zero', async () => {
    const slug = uniqueSlug('top');
    const { id } = await createCategory(ctx, STAFF, createInput(slug));
    expect(id).toBe(slug);

    const stored = await findCategoryBySlug(ctx, slug);
    expect(stored?.name).toBe(`Category ${slug}`);
    expect(stored?.productCount).toBe(0);
    expect(stored?.parentId).toBeNull();
    expect(stored?.active).toBe(true);
  });

  it('refuses a duplicate slug atomically', async () => {
    const slug = uniqueSlug('dup');
    await createCategory(ctx, STAFF, createInput(slug));
    await expect(createCategory(ctx, STAFF, createInput(slug))).rejects.toBeInstanceOf(
      CategorySlugTakenError,
    );
  });

  it('creates a child under a top-level parent', async () => {
    const parent = uniqueSlug('parent');
    await createCategory(ctx, STAFF, createInput(parent));
    const child = uniqueSlug('child');
    await createCategory(ctx, STAFF, createInput(child, { parentId: parent, sortOrder: 11 }));

    const stored = await findCategoryBySlug(ctx, child);
    expect(stored?.parentId).toBe(parent);
  });

  it('refuses a parent that does not exist', async () => {
    await expect(
      createCategory(ctx, STAFF, createInput(uniqueSlug('orphan'), { parentId: 'no-such-parent' })),
    ).rejects.toBeInstanceOf(IllegalCategoryParentError);
  });

  it('refuses a two-level-deep parent', async () => {
    const grandparent = uniqueSlug('gp');
    await createCategory(ctx, STAFF, createInput(grandparent));
    const parent = uniqueSlug('p');
    await createCategory(ctx, STAFF, createInput(parent, { parentId: grandparent }));

    await expect(
      createCategory(ctx, STAFF, createInput(uniqueSlug('c'), { parentId: parent })),
    ).rejects.toBeInstanceOf(IllegalCategoryParentError);
  });
});

describe('updateCategory', () => {
  it('renames a category and toggles its activation, preserving productCount and slug', async () => {
    const slug = uniqueSlug('edit');
    await seedCategory(slug, { productCount: 7, name: 'Old name', active: true });

    await updateCategory(ctx, STAFF, slug, {
      name: 'New name',
      parentId: null,
      active: false,
      showInNav: false,
      showInFilters: true,
      sortOrder: 42,
    });

    const stored = await findCategoryBySlug(ctx, slug);
    expect(stored?.name).toBe('New name');
    expect(stored?.active).toBe(false);
    expect(stored?.showInNav).toBe(false);
    expect(stored?.sortOrder).toBe(42);
    // The Function owns productCount; an edit leaves it untouched.
    expect(stored?.productCount).toBe(7);
    expect(stored?.slug).toBe(slug);
  });

  it('refuses to update a category that does not exist', async () => {
    await expect(
      updateCategory(ctx, STAFF, uniqueSlug('ghost'), {
        name: 'x',
        parentId: null,
        active: true,
        showInNav: true,
        showInFilters: true,
        sortOrder: 1,
      }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('refuses to give a parent to a category that has children of its own', async () => {
    const parent = uniqueSlug('haskids');
    await seedCategory(parent);
    const child = uniqueSlug('kid');
    await seedCategory(child, { parentId: parent as ReturnType<typeof aCategory>['parentId'] });
    const other = uniqueSlug('other');
    await seedCategory(other);

    await expect(
      updateCategory(ctx, STAFF, parent, {
        name: 'Has kids',
        parentId: other,
        active: true,
        showInNav: true,
        showInFilters: true,
        sortOrder: 1,
      }),
    ).rejects.toBeInstanceOf(IllegalCategoryParentError);
  });
});

describe('reorderCategories', () => {
  it('sets the sort order of several categories at once', async () => {
    const a = uniqueSlug('a');
    const b = uniqueSlug('b');
    await seedCategory(a, { sortOrder: 10 });
    await seedCategory(b, { sortOrder: 20 });

    await reorderCategories(ctx, STAFF, [
      { slug: a, sortOrder: 200 },
      { slug: b, sortOrder: 100 },
    ]);

    expect((await findCategoryBySlug(ctx, a))?.sortOrder).toBe(200);
    expect((await findCategoryBySlug(ctx, b))?.sortOrder).toBe(100);
  });
});

describe('deleteCategory', () => {
  it('deletes a category with no products and no children', async () => {
    const slug = uniqueSlug('del');
    await seedCategory(slug, { productCount: 0 });

    await deleteCategory(ctx, STAFF, slug);
    expect(await findCategoryBySlug(ctx, slug)).toBeNull();
  });

  it('refuses to delete a category that still has products', async () => {
    const slug = uniqueSlug('hasproducts');
    await seedCategory(slug, { productCount: 3 });

    await expect(deleteCategory(ctx, STAFF, slug)).rejects.toBeInstanceOf(CategoryHasProductsError);
    expect(await findCategoryBySlug(ctx, slug)).not.toBeNull();
  });

  it('refuses to delete a category that still has children', async () => {
    const parent = uniqueSlug('parentdel');
    await seedCategory(parent, { productCount: 0 });
    const child = uniqueSlug('childdel');
    await seedCategory(child, {
      productCount: 0,
      parentId: parent as ReturnType<typeof aCategory>['parentId'],
    });

    await expect(deleteCategory(ctx, STAFF, parent)).rejects.toBeInstanceOf(
      CategoryHasChildrenError,
    );
    expect(await findCategoryBySlug(ctx, parent)).not.toBeNull();
  });

  it('lists categories ordered by sortOrder', async () => {
    // A read sanity check across the collection the writes populate.
    const all = await listCategories(ctx);
    const orders = all.map((category) => category.sortOrder);
    expect([...orders]).toEqual([...orders].sort((x, y) => x - y));
  });
});

describe('applyProductCountDeltas (the trigger body) against Firestore', () => {
  it('increments the leaf and its ancestor via FieldValue.increment', async () => {
    const parent = uniqueSlug('cnt-parent');
    const child = uniqueSlug('cnt-child');
    await seedCategory(parent, { parentId: null, productCount: 0 });
    await seedCategory(child, {
      parentId: parent as ReturnType<typeof aCategory>['parentId'],
      productCount: 0,
    });

    await applyProductCountDeltas(ctx, null, { categorySlug: child, active: true });

    expect((await findCategoryBySlug(ctx, child))?.productCount).toBe(1);
    expect((await findCategoryBySlug(ctx, parent))?.productCount).toBe(1);

    // Archiving it (active -> gone) reverses both.
    await applyProductCountDeltas(ctx, { categorySlug: child, active: true }, null);
    expect((await findCategoryBySlug(ctx, child))?.productCount).toBe(0);
    expect((await findCategoryBySlug(ctx, parent))?.productCount).toBe(0);
  });
});

describe('reconcileCategoryCount against Firestore', () => {
  it('corrects a drifted count from the real products', async () => {
    const slug = uniqueSlug('recon');
    await seedCategory(slug, { parentId: null, productCount: 99 });
    // One active product filed under it; a draft that must not count.
    await ctx.db
      .doc(`products/${uniqueSlug('p-active')}`)
      .withConverter(converters.products)
      .set(aProductFixture(slug, 'active'));
    await ctx.db
      .doc(`products/${uniqueSlug('p-draft')}`)
      .withConverter(converters.products)
      .set(aProductFixture(slug, 'draft'));

    const report = await reconcileCategoryCount(ctx, STAFF, slug, { fix: true });
    expect(report.actual).toBe(1);
    expect(report.corrected).toBe(true);
    expect((await findCategoryBySlug(ctx, slug))?.productCount).toBe(1);
  });
});
