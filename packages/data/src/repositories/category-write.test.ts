import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import { aCategory, aProduct } from '@romp/contracts/fixtures';

// The repo writes productCount with FieldValue.increment; the fake resolves it as a tagged
// object so a delta can be applied to the stored number without a real Firestore.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (by: number) => ({ __increment: by }) },
}));

import { fixedClock } from '../clock';
import { ANONYMOUS, asCustomer, asOperator, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import {
  CategoryHasChildrenError,
  CategoryHasProductsError,
  CategoryNotFoundError,
  CategorySlugTakenError,
  IllegalCategoryParentError,
  applyProductCountDeltas,
  createCategory,
  deleteCategory,
  reconcileCategoryCount,
  reorderCategories,
  updateCategory,
} from './category-write';

/**
 * Unit tests for the category write repository.
 *
 * The tree arithmetic is `@romp/core`'s and tested there; here a transaction-capable Firestore
 * double asserts the orchestration: the staff gate, slug uniqueness via a create-only write,
 * parent validation against the current tree, the reorder batch, and the delete refusals when a
 * category still has products or children. End-to-end against real Firestore is in
 * `infra/tests/category-write.test.ts`.
 */

const NOW = new Date('2026-03-01T09:30:00.000Z');
const STAFF = asOperator('staff-1', 'staff');
const CUSTOMER = asCustomer('cust-1');

interface StoredDoc {
  readonly path: string;
  data: Record<string, unknown>;
}

interface Converter {
  toFirestore: (v: unknown) => Record<string, unknown>;
  fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
}

/** Merges an update patch, resolving the mocked `FieldValue.increment` sentinel against the current value. */
function applyPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === 'object' && value !== null && '__increment' in value) {
      next[key] =
        ((current[key] as number | undefined) ?? 0) +
        (value as { __increment: number }).__increment;
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * A transaction- and batch-capable Firestore double for the category writes.
 *
 * It stores decoded documents by path, honours converters, enforces `tx.get`-before-`tx.set`,
 * supports `create` (ALREADY_EXISTS on a present path), collection `get`, `where('parentId')`
 * queries, `batch().update()/commit()`, and `tx.delete`. `writes`/`deletes` record what landed.
 */
function fakeDb(seed: readonly StoredDoc[] = []) {
  const store = new Map<string, Record<string, unknown>>(seed.map((d) => [d.path, d.data]));
  const deletes: string[] = [];

  const decode = (
    path: string,
    raw: Record<string, unknown> | undefined,
    converter: Converter | null,
  ) => {
    const id = path.split('/').at(-1) ?? '';
    return raw === undefined || converter === null
      ? raw
      : (converter.fromFirestore({ id, data: () => raw }) as Record<string, unknown>);
  };

  const docRef = (path: string) => {
    let converter: Converter | null = null;
    const ref = {
      path,
      id: path.split('/').at(-1) ?? '',
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      get converter() {
        return converter;
      },
      create: (data: unknown) => {
        if (store.has(path)) {
          const error = Object.assign(new Error('ALREADY_EXISTS: entity already exists'), {
            code: 6,
          });
          return Promise.reject(error);
        }
        store.set(
          path,
          (converter === null ? data : converter.toFirestore(data)) as Record<string, unknown>,
        );
        return Promise.resolve();
      },
      get: () => {
        const raw = store.get(path);
        return Promise.resolve({
          id: ref.id,
          exists: raw !== undefined,
          data: () => decode(path, raw, converter),
        });
      },
      update: (patch: Record<string, unknown>) => {
        store.set(path, applyPatch(store.get(path) ?? {}, patch));
        return Promise.resolve();
      },
    };
    return ref;
  };

  // A collection reference supporting withConverter + get + where(parentId).limit.
  const collectionRef = (path: string) => {
    let converter: Converter | null = null;
    const filters: [string, string, unknown][] = [];
    const ref = {
      path,
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      where: (field: string, op: string, value: unknown) => {
        filters.push([field, op, value]);
        return ref;
      },
      limit: () => ref,
      matchingDocs: () => {
        const prefix = `${path}/`;
        return [...store.entries()]
          .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map(([key, raw]) => ({ id: key.slice(prefix.length), path: key, raw }))
          .filter(({ raw }) => filters.every(([field, , value]) => raw[field] === value));
      },
      get converter() {
        return converter;
      },
      get: () => {
        const docs = ref.matchingDocs().map(({ id, raw }) => ({
          id,
          data: () => decode(`${path}/${id}`, raw, converter),
        }));
        return Promise.resolve({ docs, empty: docs.length === 0 });
      },
    };
    return ref;
  };

  type DocRef = ReturnType<typeof docRef>;
  type CollectionRef = ReturnType<typeof collectionRef>;

  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: DocRef | CollectionRef) => Promise<unknown>;
      set: (ref: DocRef, data: unknown) => void;
      update: (ref: DocRef, patch: Record<string, unknown>) => void;
      delete: (ref: DocRef) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    let hasWritten = false;
    const staged: { path: string; data: Record<string, unknown> }[] = [];
    const stagedDeletes: string[] = [];

    const tx = {
      get: (ref: DocRef | CollectionRef) => {
        if (hasWritten) {
          throw new Error('Firestore transactions require all reads before writes.');
        }
        if ('where' in ref) {
          const docs = ref.matchingDocs().map(({ id, path, raw }) => ({
            id,
            data: () => decode(path, raw, ref.converter),
          }));
          return Promise.resolve({ docs, empty: docs.length === 0 });
        }
        const raw = store.get(ref.path);
        return Promise.resolve({
          id: ref.id,
          exists: raw !== undefined,
          data: () => decode(ref.path, raw, ref.converter),
        });
      },
      set: (ref: DocRef, data: unknown) => {
        hasWritten = true;
        staged.push({
          path: ref.path,
          data: (ref.converter === null ? data : ref.converter.toFirestore(data)) as Record<
            string,
            unknown
          >,
        });
      },
      update: (ref: DocRef, patch: Record<string, unknown>) => {
        hasWritten = true;
        staged.push({ path: ref.path, data: applyPatch(store.get(ref.path) ?? {}, patch) });
      },
      delete: (ref: DocRef) => {
        hasWritten = true;
        stagedDeletes.push(ref.path);
      },
    };

    const result = await fn(tx);
    for (const write of staged) store.set(write.path, write.data);
    for (const path of stagedDeletes) {
      store.delete(path);
      deletes.push(path);
    }
    return result;
  };

  const batch = () => {
    const ops: { path: string; data: Record<string, unknown> }[] = [];
    return {
      update: (ref: DocRef, data: Record<string, unknown>) => {
        ops.push({ path: ref.path, data });
      },
      commit: () => {
        for (const op of ops) store.set(op.path, { ...(store.get(op.path) ?? {}), ...op.data });
        return Promise.resolve();
      },
    };
  };

  const db = {
    doc: docRef,
    collection: collectionRef,
    runTransaction,
    batch,
  } as unknown as Firestore;
  return { db, store, deletes };
}

function ctxWith(db: Firestore): StoreContext {
  return createStoreContext({ storeId: 'test-store', db, clock: fixedClock(NOW) });
}

/** A stored category at `categories/{slug}`, encoded through the converter. */
function storedCategory(slug: string, overrides: Record<string, unknown> = {}): StoredDoc {
  return {
    path: `categories/${slug}`,
    data: converters.categories.toFirestore(
      aCategory({ slug: slug as ReturnType<typeof aCategory>['slug'], ...overrides }),
    ),
  };
}

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

const updateInput = (overrides: Record<string, unknown> = {}) => ({
  name: 'Updated',
  parentId: null,
  active: true,
  showInNav: true,
  showInFilters: true,
  sortOrder: 10,
  ...overrides,
});

describe('createCategory', () => {
  it('refuses a non-staff caller before touching Firestore', async () => {
    const { db, store } = fakeDb();
    await expect(createCategory(ctxWith(db), CUSTOMER, createInput('x'))).rejects.toThrow();
    await expect(createCategory(ctxWith(db), ANONYMOUS, createInput('x'))).rejects.toThrow();
    expect(store.size).toBe(0);
  });

  it('creates a top-level category with productCount seeded to zero', async () => {
    const { db, store } = fakeDb();
    const { id } = await createCategory(ctxWith(db), STAFF, createInput('wooden'));
    expect(id).toBe('wooden');
    // The stored form keeps these fields as plain values, so assert on it directly.
    const stored = store.get('categories/wooden');
    expect(stored?.productCount).toBe(0);
    expect(stored?.parentId).toBeNull();
  });

  it('refuses a duplicate slug (create-only write)', async () => {
    const { db } = fakeDb([storedCategory('wooden')]);
    await expect(createCategory(ctxWith(db), STAFF, createInput('wooden'))).rejects.toBeInstanceOf(
      CategorySlugTakenError,
    );
  });

  it('creates a child under a top-level parent', async () => {
    const { db, store } = fakeDb([storedCategory('wooden', { parentId: null })]);
    await createCategory(ctxWith(db), STAFF, createInput('sensory', { parentId: 'wooden' }));
    expect(store.has('categories/sensory')).toBe(true);
  });

  it('refuses an unknown parent', async () => {
    const { db } = fakeDb();
    await expect(
      createCategory(ctxWith(db), STAFF, createInput('sensory', { parentId: 'nope' })),
    ).rejects.toBeInstanceOf(IllegalCategoryParentError);
  });

  it('refuses a two-level-deep parent', async () => {
    const { db } = fakeDb([
      storedCategory('wooden', { parentId: null }),
      storedCategory('sensory', { parentId: 'wooden' }),
    ]);
    await expect(
      createCategory(ctxWith(db), STAFF, createInput('deep', { parentId: 'sensory' })),
    ).rejects.toBeInstanceOf(IllegalCategoryParentError);
  });
});

describe('updateCategory', () => {
  it('renames and toggles activation, preserving productCount and slug', async () => {
    const { db, store } = fakeDb([storedCategory('wooden', { productCount: 7, active: true })]);
    await updateCategory(
      ctxWith(db),
      STAFF,
      'wooden',
      updateInput({ name: 'Wooden toys', active: false, showInNav: false, sortOrder: 42 }),
    );
    const stored = store.get('categories/wooden');
    expect(stored?.name).toBe('Wooden toys');
    expect(stored?.active).toBe(false);
    expect(stored?.showInNav).toBe(false);
    expect(stored?.sortOrder).toBe(42);
    expect(stored?.productCount).toBe(7);
    expect(stored?.slug).toBe('wooden');
  });

  it('throws when the category does not exist', async () => {
    const { db } = fakeDb();
    await expect(updateCategory(ctxWith(db), STAFF, 'ghost', updateInput())).rejects.toBeInstanceOf(
      CategoryNotFoundError,
    );
  });

  it('refuses giving a parent to a category that has children', async () => {
    const { db } = fakeDb([
      storedCategory('wooden', { parentId: null }),
      storedCategory('sensory', { parentId: 'wooden' }),
      storedCategory('puzzles', { parentId: null }),
    ]);
    await expect(
      updateCategory(ctxWith(db), STAFF, 'wooden', updateInput({ parentId: 'puzzles' })),
    ).rejects.toBeInstanceOf(IllegalCategoryParentError);
  });
});

describe('reorderCategories', () => {
  it('updates each category sortOrder in a batch', async () => {
    const { db, store } = fakeDb([
      storedCategory('a', { sortOrder: 10 }),
      storedCategory('b', { sortOrder: 20 }),
    ]);
    await reorderCategories(ctxWith(db), STAFF, [
      { slug: 'a', sortOrder: 200 },
      { slug: 'b', sortOrder: 100 },
    ]);
    expect(store.get('categories/a')?.sortOrder).toBe(200);
    expect(store.get('categories/b')?.sortOrder).toBe(100);
  });

  it('refuses a non-staff caller', async () => {
    const { db } = fakeDb();
    await expect(
      reorderCategories(ctxWith(db), CUSTOMER, [{ slug: 'a', sortOrder: 1 }]),
    ).rejects.toThrow();
  });
});

describe('deleteCategory', () => {
  it('deletes a category with no products and no children', async () => {
    const { db, store, deletes } = fakeDb([storedCategory('empty', { productCount: 0 })]);
    await deleteCategory(ctxWith(db), STAFF, 'empty');
    expect(store.has('categories/empty')).toBe(false);
    expect(deletes).toEqual(['categories/empty']);
  });

  it('throws when the category does not exist', async () => {
    const { db } = fakeDb();
    await expect(deleteCategory(ctxWith(db), STAFF, 'ghost')).rejects.toBeInstanceOf(
      CategoryNotFoundError,
    );
  });

  it('refuses to delete a category that still has products', async () => {
    const { db, store } = fakeDb([storedCategory('busy', { productCount: 3 })]);
    await expect(deleteCategory(ctxWith(db), STAFF, 'busy')).rejects.toBeInstanceOf(
      CategoryHasProductsError,
    );
    expect(store.has('categories/busy')).toBe(true);
  });

  it('refuses to delete a category that still has children', async () => {
    const { db, store } = fakeDb([
      storedCategory('parent', { productCount: 0 }),
      storedCategory('child', {
        productCount: 0,
        parentId: 'parent',
      }),
    ]);
    await expect(deleteCategory(ctxWith(db), STAFF, 'parent')).rejects.toBeInstanceOf(
      CategoryHasChildrenError,
    );
    expect(store.has('categories/parent')).toBe(true);
  });
});

describe('applyProductCountDeltas', () => {
  // wooden (top) <- sensory (child); a product under sensory counts for both.
  const tree = () => [
    storedCategory('wooden', { parentId: null, productCount: 0 }),
    storedCategory('sensory', { parentId: 'wooden', productCount: 0 }),
  ];

  it('increments the leaf and every ancestor when an active product appears', async () => {
    const { db, store } = fakeDb(tree());
    await applyProductCountDeltas(ctxWith(db), null, { categorySlug: 'sensory', active: true });
    expect(store.get('categories/sensory')?.productCount).toBe(1);
    expect(store.get('categories/wooden')?.productCount).toBe(1);
  });

  it('decrements up the chain when an active product is removed', async () => {
    const { db, store } = fakeDb([
      storedCategory('wooden', { parentId: null, productCount: 5 }),
      storedCategory('sensory', { parentId: 'wooden', productCount: 3 }),
    ]);
    await applyProductCountDeltas(ctxWith(db), { categorySlug: 'sensory', active: true }, null);
    expect(store.get('categories/sensory')?.productCount).toBe(2);
    expect(store.get('categories/wooden')?.productCount).toBe(4);
  });

  it('does nothing when the write does not change what is counted', async () => {
    const { db, store } = fakeDb(tree());
    await applyProductCountDeltas(
      ctxWith(db),
      { categorySlug: 'sensory', active: false },
      { categorySlug: 'sensory', active: false },
    );
    expect(store.get('categories/sensory')?.productCount).toBe(0);
  });

  it('skips a delta for a category that no longer exists', async () => {
    const { db, store } = fakeDb([storedCategory('wooden', { parentId: null, productCount: 0 })]);
    await applyProductCountDeltas(ctxWith(db), null, { categorySlug: 'gone', active: true });
    expect(store.has('categories/gone')).toBe(false);
    expect(store.get('categories/wooden')?.productCount).toBe(0);
  });
});

describe('reconcileCategoryCount', () => {
  /** A stored product under a category slug. */
  function storedProduct(id: string, categorySlug: string, status = 'active'): StoredDoc {
    return {
      path: `products/${id}`,
      data: converters.products.toFirestore(
        aProduct({
          categorySlug: categorySlug as ReturnType<typeof aProduct>['categorySlug'],
          status: status as ReturnType<typeof aProduct>['status'],
        }),
      ),
    };
  }

  it('reports a balanced category without writing', async () => {
    const { db, store } = fakeDb([
      storedCategory('wooden', { parentId: null, productCount: 1 }),
      storedProduct('p1', 'wooden'),
    ]);
    const result = await reconcileCategoryCount(ctxWith(db), STAFF, 'wooden');
    expect(result).toEqual({ slug: 'wooden', stored: 1, actual: 1, corrected: false });
    expect(store.get('categories/wooden')?.productCount).toBe(1);
  });

  it('corrects a drifted count, rolling up a child category', async () => {
    const { db, store } = fakeDb([
      storedCategory('wooden', { parentId: null, productCount: 99 }),
      storedCategory('sensory', { parentId: 'wooden', productCount: 0 }),
      storedProduct('p1', 'wooden'),
      storedProduct('p2', 'sensory'),
      storedProduct('p3', 'sensory', 'draft'), // not counted
    ]);
    const result = await reconcileCategoryCount(ctxWith(db), STAFF, 'wooden', { fix: true });
    expect(result.actual).toBe(2);
    expect(result.corrected).toBe(true);
    expect(store.get('categories/wooden')?.productCount).toBe(2);
  });

  it('reports drift without correcting it in report-only mode', async () => {
    const { db, store } = fakeDb([
      storedCategory('wooden', { parentId: null, productCount: 99 }),
      storedProduct('p1', 'wooden'),
    ]);
    const result = await reconcileCategoryCount(ctxWith(db), STAFF, 'wooden');
    expect(result).toEqual({ slug: 'wooden', stored: 99, actual: 1, corrected: false });
    expect(store.get('categories/wooden')?.productCount).toBe(99);
  });

  it('throws for a missing category', async () => {
    const { db } = fakeDb();
    await expect(reconcileCategoryCount(ctxWith(db), STAFF, 'ghost')).rejects.toBeInstanceOf(
      CategoryNotFoundError,
    );
  });

  it('refuses a non-staff caller', async () => {
    const { db } = fakeDb([storedCategory('wooden')]);
    await expect(reconcileCategoryCount(ctxWith(db), CUSTOMER, 'wooden')).rejects.toThrow();
  });
});
