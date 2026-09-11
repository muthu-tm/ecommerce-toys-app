import { FieldValue } from 'firebase-admin/firestore';

import type { CategoryDoc } from '@romp/contracts';
import { planProductCountChanges, validateCategoryParent } from '@romp/core';
import type { CategoryParentRefusal, CountableProduct } from '@romp/core';

import type { Caller, StoreContext } from '../context';
import { requireStaff } from '../context';
import { converters } from '../converters';
import { isAlreadyExists } from '../firestore-errors';
import { COLLECTIONS, paths } from '../paths';

/**
 * The category write paths.
 *
 * Categories are the storefront's navigation and its facet sidebar, so the invariants here are
 * about the *tree*, not about money: a slug is a URL identity and must be unique; the tree is one
 * level deep by design; and a category with products under it or children beneath it cannot just
 * vanish. `productCount` is deliberately **not** written here — it is a denormalised facet count
 * owned by the product-write Function, so a category create seeds it to zero and every later
 * write leaves it alone, letting the Function be the single writer that can keep it correct.
 *
 * The tree-legality decision (`validateCategoryParent`) is pure and lives in `@romp/core`; this
 * module reads the current tree to supply it the facts and is the Firestore plumbing around it.
 * Every write is staff-only, and the slug is fixed at create time — editing a slug would break
 * every link and every product's denormalised `categorySlug`, so a rename changes the name, not
 * the identity.
 */

const CATEGORY_RESOURCE = { resource: 'category' } as const;

/** The fields supplied when creating a category. `slug` becomes the document ID. */
export interface CategoryCreateInput {
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
  readonly active: boolean;
  readonly showInNav: boolean;
  readonly showInFilters: boolean;
  readonly sortOrder: number;
}

/** The mutable fields of a category. The slug is immutable — it is the identity. */
export interface CategoryUpdateInput {
  readonly name: string;
  readonly parentId: string | null;
  readonly active: boolean;
  readonly showInNav: boolean;
  readonly showInFilters: boolean;
  readonly sortOrder: number;
}

/** Raised when a category write targets a slug that does not exist. */
export class CategoryNotFoundError extends Error {
  readonly slug: string;
  constructor(slug: string) {
    super(`Category "${slug}" does not exist.`);
    this.name = 'CategoryNotFoundError';
    this.slug = slug;
  }
}

/** Raised when a create would reuse a slug that is already a category. */
export class CategorySlugTakenError extends Error {
  readonly slug: string;
  constructor(slug: string) {
    super(`A category with the slug "${slug}" already exists.`);
    this.name = 'CategorySlugTakenError';
    this.slug = slug;
  }
}

/** Raised when a proposed parent would make the tree illegal. Carries the pure reason. */
export class IllegalCategoryParentError extends Error {
  readonly reason: CategoryParentRefusal;
  constructor(reason: CategoryParentRefusal) {
    super(`The category parent is not allowed: ${reason}.`);
    this.name = 'IllegalCategoryParentError';
    this.reason = reason;
  }
}

/** Raised when deleting a category that still has products filed under it. */
export class CategoryHasProductsError extends Error {
  readonly slug: string;
  readonly productCount: number;
  constructor(slug: string, productCount: number) {
    super(`Category "${slug}" still has ${String(productCount)} product(s) and cannot be deleted.`);
    this.name = 'CategoryHasProductsError';
    this.slug = slug;
    this.productCount = productCount;
  }
}

/** Raised when deleting a category that still has child categories. */
export class CategoryHasChildrenError extends Error {
  readonly slug: string;
  constructor(slug: string) {
    super(`Category "${slug}" still has child categories and cannot be deleted.`);
    this.name = 'CategoryHasChildrenError';
    this.slug = slug;
  }
}

/**
 * Reads the whole (small) category collection as the tree facts the pure validator needs.
 *
 * Reads **raw**, not through the validating converter, and pulls only `slug` and `parentId`. The
 * tree check only needs those two, and decoding every document through the full schema would make
 * one malformed or partially-migrated category break every create and edit — a blast radius far
 * larger than the two fields warrant. The document ID is the slug, which is the authority; the
 * `slug` field is a self-describing copy, so the ID is used when the field is absent.
 */
async function readTree(
  ctx: StoreContext,
): Promise<{ parentBySlug: Map<string, string | null>; childrenOf: Map<string, number> }> {
  const snapshot = await ctx.db.collection(COLLECTIONS.categories).get();
  const parentBySlug = new Map<string, string | null>();
  const childrenOf = new Map<string, number>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const slug = typeof data.slug === 'string' ? data.slug : doc.id;
    const parentId = typeof data.parentId === 'string' ? data.parentId : null;
    parentBySlug.set(slug, parentId);
    if (parentId !== null) {
      childrenOf.set(parentId, (childrenOf.get(parentId) ?? 0) + 1);
    }
  }
  return { parentBySlug, childrenOf };
}

/**
 * Creates a category.
 *
 * The parent, if any, is validated against the current tree (it must exist and be top-level, and
 * a create has no children of its own). Uniqueness is enforced by the write itself: the document
 * ID is the slug, so `create` fails atomically if that slug is already a category — the same
 * reservation trick the identity index uses, with no read-then-write race. `productCount` starts
 * at zero and is thereafter the Function's to maintain.
 */
export async function createCategory(
  ctx: StoreContext,
  caller: Caller,
  input: CategoryCreateInput,
): Promise<{ readonly id: string }> {
  requireStaff(caller, CATEGORY_RESOURCE);

  const { parentBySlug } = await readTree(ctx);
  // A new category has no children, so `would_orphan_children` cannot arise here.
  const verdict = validateCategoryParent(input.slug, input.parentId, parentBySlug, false);
  if (!verdict.ok) throw new IllegalCategoryParentError(verdict.reason);

  const now = ctx.clock.now();
  const doc: CategoryDoc = {
    name: input.name,
    slug: input.slug as CategoryDoc['slug'],
    parentId: input.parentId as CategoryDoc['parentId'],
    active: input.active,
    showInNav: input.showInNav,
    showInFilters: input.showInFilters,
    productCount: 0,
    sortOrder: input.sortOrder,
    createdAt: now,
    updatedAt: now,
  };

  const ref = ctx.db.doc(paths.category(input.slug)).withConverter(converters.categories);
  try {
    await ref.create(doc);
  } catch (error) {
    if (isAlreadyExists(error)) throw new CategorySlugTakenError(input.slug);
    throw error;
  }

  return { id: input.slug };
}

/**
 * Updates a category's mutable fields.
 *
 * A transaction so the read that confirms the category exists and validates the parent change
 * cannot race a concurrent tree edit. The parent is re-validated against the current tree — a
 * category being given a parent must not already have children, which is why the tree read
 * happens here and not only at create. `productCount` and `slug` are preserved untouched; the
 * Function owns the first and the identity owns the second.
 */
export async function updateCategory(
  ctx: StoreContext,
  caller: Caller,
  slug: string,
  patch: CategoryUpdateInput,
): Promise<void> {
  requireStaff(caller, CATEGORY_RESOURCE);

  const { parentBySlug, childrenOf } = await readTree(ctx);
  const verdict = validateCategoryParent(
    slug,
    patch.parentId,
    parentBySlug,
    (childrenOf.get(slug) ?? 0) > 0,
  );
  if (!verdict.ok) throw new IllegalCategoryParentError(verdict.reason);

  const ref = ctx.db.doc(paths.category(slug)).withConverter(converters.categories);

  await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (current === undefined) throw new CategoryNotFoundError(slug);

    const next: CategoryDoc = {
      ...current,
      name: patch.name,
      parentId: patch.parentId as CategoryDoc['parentId'],
      active: patch.active,
      showInNav: patch.showInNav,
      showInFilters: patch.showInFilters,
      sortOrder: patch.sortOrder,
      updatedAt: ctx.clock.now(),
    };

    tx.set(ref, next);
  });
}

/**
 * Sets the sort order of several categories at once.
 *
 * A drag-reorder submits the whole new ordering, so this writes each `sortOrder` in one batch —
 * atomic enough for ordering, where a partially-applied reorder is a cosmetic glitch, not a
 * broken invariant, and cheaper than a transaction that reads every document first. A slug that
 * does not exist is skipped rather than failing the batch: the reorder of the categories that do
 * exist should still land. Only `sortOrder` and `updatedAt` change.
 */
export async function reorderCategories(
  ctx: StoreContext,
  caller: Caller,
  orders: readonly { readonly slug: string; readonly sortOrder: number }[],
): Promise<void> {
  requireStaff(caller, CATEGORY_RESOURCE);

  const now = ctx.clock.now();
  const batch = ctx.db.batch();
  for (const { slug, sortOrder } of orders) {
    const ref = ctx.db.doc(paths.category(slug));
    batch.update(ref, { sortOrder, updatedAt: now });
  }
  await batch.commit();
}

/**
 * Deletes a category, refusing while anything still depends on it.
 *
 * A category with products filed under it, or with child categories beneath it, cannot be
 * deleted — doing so would strand products in a category that no listing can produce, or orphan
 * a subtree. Both are read in the same transaction as the delete so the check cannot race a
 * concurrent product or child write. The caller (an operator) reactivates-and-empties or
 * reparents first; the refusal is a 409 at the API.
 */
export async function deleteCategory(
  ctx: StoreContext,
  caller: Caller,
  slug: string,
): Promise<void> {
  requireStaff(caller, CATEGORY_RESOURCE);

  const ref = ctx.db.doc(paths.category(slug)).withConverter(converters.categories);
  const childQuery = ctx.db
    .collection(COLLECTIONS.categories)
    .withConverter(converters.categories)
    .where('parentId', '==', slug)
    .limit(1);

  await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (current === undefined) throw new CategoryNotFoundError(slug);

    if (current.productCount > 0) {
      throw new CategoryHasProductsError(slug, current.productCount);
    }

    const children = await tx.get(childQuery);
    if (!children.empty) throw new CategoryHasChildrenError(slug);

    tx.delete(ref);
  });
}

/**
 * Applies the `productCount` change a single product write implies, rolled up the tree.
 *
 * Called by the product-write Function with the product's before and after state. It reads the
 * (small) category tree for the ancestor chain, asks `@romp/core` for the per-category deltas, and
 * applies each as a `FieldValue.increment` in one transaction — an increment rather than a
 * read-modify-write, so concurrent product writes to the same category cannot lose each other's
 * count. Nothing happens when the write does not change what is counted (a draft edited, a field
 * unrelated to category or status touched), which is the common case.
 *
 * `productCount` is written on a **raw** document reference, deliberately not through the
 * category converter: the converter rejects `FieldValue` sentinels (a sentinel is not a value a
 * schema can validate), and `update` touches only the two named fields rather than round-tripping
 * the whole document. A delta for a category that does not exist is skipped — a product filed
 * under a since-deleted category should not resurrect a counter.
 */
export async function applyProductCountDeltas(
  ctx: StoreContext,
  before: CountableProduct | null,
  after: CountableProduct | null,
): Promise<void> {
  const { parentBySlug } = await readTree(ctx);
  const deltas = planProductCountChanges(before, after, parentBySlug);
  if (deltas.length === 0) return;

  const now = ctx.clock.now();
  await ctx.db.runTransaction(async (tx) => {
    // Read every target first (transactions require all reads before any writes), so a delta
    // for a missing category is skipped rather than creating a partial document.
    const targets = deltas.map(({ slug, delta }) => ({
      ref: ctx.db.doc(paths.category(slug)),
      delta,
    }));
    const snapshots = await Promise.all(targets.map((target) => tx.get(target.ref)));

    targets.forEach((target, index) => {
      const snapshot = snapshots[index];
      if (!snapshot?.exists) return;
      tx.update(target.ref, {
        productCount: FieldValue.increment(target.delta),
        updatedAt: now,
      });
    });
  });
}

/**
 * Recomputes one category's `productCount` from the products actually filed under it, and its
 * descendants, and corrects the stored count if it has drifted.
 *
 * `productCount` is a denormalised counter maintained by increments, and any counter maintained
 * by increments can drift — a Function retry that double-applies, a manual Firestore edit, a
 * backfill. This is the reconciliation path the counter needs: it counts the `active` products
 * whose `categorySlug` is this category or one of its children, compares to the stored number,
 * and writes the truth when they disagree. Returns what it found either way, so a script can
 * report a clean tree as well as fix a broken one.
 */
export async function reconcileCategoryCount(
  ctx: StoreContext,
  caller: Caller,
  slug: string,
  options: { readonly fix?: boolean } = {},
): Promise<{
  readonly slug: string;
  readonly stored: number;
  readonly actual: number;
  readonly corrected: boolean;
}> {
  requireStaff(caller, CATEGORY_RESOURCE);

  const ref = ctx.db.doc(paths.category(slug)).withConverter(converters.categories);
  const [categorySnap, treeSnap, activeProducts] = await Promise.all([
    ref.get(),
    // Raw tree read (see `readTree`): only the parent links matter, and one bad category
    // document should not break reconciliation of a healthy one.
    ctx.db.collection(COLLECTIONS.categories).get(),
    // Raw product read, filtered server-side to active: only `categorySlug` is needed, and
    // decoding every product through the full schema would let one malformed product break the
    // count of an unrelated category.
    ctx.db.collection(COLLECTIONS.products).where('status', '==', 'active').get(),
  ]);

  const category = categorySnap.data();
  if (category === undefined) throw new CategoryNotFoundError(slug);

  // The slugs counted by this category: itself and every direct child (the tree is one level).
  const childSlugs = treeSnap.docs
    .filter((doc) => doc.data().parentId === slug)
    .map((doc) => (typeof doc.data().slug === 'string' ? (doc.data().slug as string) : doc.id));
  const counted = new Set<string>([slug, ...childSlugs]);

  const actual = activeProducts.docs.filter((doc) =>
    counted.has(doc.data().categorySlug as string),
  ).length;

  const stored = category.productCount;
  // Report-only by default: a diagnosis run against production must not write. Only `fix`
  // corrects the drift, so the read half of the reconciliation is safe to run anywhere.
  if (stored === actual || options.fix !== true) {
    return { slug, stored, actual, corrected: false };
  }

  await ctx.db
    .doc(paths.category(slug))
    .update({ productCount: actual, updatedAt: ctx.clock.now() });
  return { slug, stored, actual, corrected: true };
}
