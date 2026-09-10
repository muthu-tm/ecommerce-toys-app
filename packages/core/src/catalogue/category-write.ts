/**
 * The pure logic behind category management.
 *
 * Two things here that a schema cannot express and a Firestore transaction should not have to
 * reason about inline: how a product write changes the denormalised `categories.productCount`,
 * and whether a proposed parent keeps the tree legal. Both are pure — current facts in, the
 * change or a typed refusal out — so they are unit-tested without an emulator, where a wrong
 * facet count is a category page advertising products it cannot list and a bad parent is a
 * category nobody can reach.
 *
 * `@romp/data` calls these, then applies the deltas with `FieldValue.increment` and writes the
 * category document. Nothing here touches Firestore.
 */

/** A product, reduced to the two fields that decide whether and where it is counted. */
export interface CountableProduct {
  /** The leaf category the product sits in (a slug). Null if it has none. */
  readonly categorySlug: string | null;
  /** Only `active` products are counted — a draft in a facet count is a count no listing can produce. */
  readonly active: boolean;
}

/** A signed change to one category's `productCount`. */
export interface ProductCountDelta {
  readonly slug: string;
  readonly delta: number;
}

/**
 * The per-category `productCount` deltas a single product write implies.
 *
 * A product contributes +1 to its leaf category **and every ancestor** (the sidebar count for
 * "Wooden" includes products filed under its child "Sensory"), but only while it is `active`.
 * So a create of an active product is +1 up the chain, an archive is −1, and a recategorisation
 * or an activation/deactivation is the difference between the two chains. Comparing the before
 * and after contribution per slug over the union of both chains yields exactly the net change,
 * and slugs whose delta is zero are dropped — a no-op write touches no counter.
 *
 * `parentBySlug` maps a category slug to its parent slug (or null); it is how the walk finds the
 * ancestors. A slug missing from the map is treated as top-level, so a product filed under a
 * category that was since deleted still resolves rather than looping.
 */
export function planProductCountChanges(
  before: CountableProduct | null,
  after: CountableProduct | null,
  parentBySlug: ReadonlyMap<string, string | null>,
): readonly ProductCountDelta[] {
  const contribution = (product: CountableProduct | null): ReadonlyMap<string, number> => {
    const counts = new Map<string, number>();
    if (product === null || !product.active || product.categorySlug === null) return counts;

    let slug: string | null = product.categorySlug;
    const visited = new Set<string>();
    while (slug !== null && !visited.has(slug)) {
      visited.add(slug);
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
      slug = parentBySlug.get(slug) ?? null;
    }
    return counts;
  };

  const beforeCounts = contribution(before);
  const afterCounts = contribution(after);

  const slugs = new Set<string>([...beforeCounts.keys(), ...afterCounts.keys()]);
  const deltas: ProductCountDelta[] = [];
  for (const slug of slugs) {
    const delta = (afterCounts.get(slug) ?? 0) - (beforeCounts.get(slug) ?? 0);
    if (delta !== 0) deltas.push({ slug, delta });
  }
  return deltas;
}

/**
 * Why a proposed parent is illegal.
 *
 *  - `self_parent`: a category cannot be its own parent.
 *  - `parent_not_found`: the parent slug is not a known category.
 *  - `too_deep`: the parent already has a parent. The tree is one level by design — a deeper
 *    tree needs breadcrumb and navigation work v1.0 does not have — so a grandchild is refused
 *    rather than rendered unreachable.
 *  - `would_orphan_children`: the category being reparented has children of its own, so giving
 *    it a parent would make those children grandchildren. Refused for the same one-level reason.
 */
export type CategoryParentRefusal =
  'self_parent' | 'parent_not_found' | 'too_deep' | 'would_orphan_children';

export type ValidateCategoryParentResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: CategoryParentRefusal };

/**
 * Whether `slug` may have `parentSlug` as its parent, keeping the tree one level deep.
 *
 * A null `parentSlug` (making the category top-level) is always legal. Otherwise the parent must
 * exist, must not be the category itself, and must itself be top-level; and the category being
 * reparented must not already have children. `parentBySlug` and `hasChildren` are the two facts
 * the caller reads from the current tree; this function only decides.
 */
export function validateCategoryParent(
  slug: string,
  parentSlug: string | null,
  parentBySlug: ReadonlyMap<string, string | null>,
  hasChildren: boolean,
): ValidateCategoryParentResult {
  if (parentSlug === null) return { ok: true };
  if (parentSlug === slug) return { ok: false, reason: 'self_parent' };
  if (!parentBySlug.has(parentSlug)) return { ok: false, reason: 'parent_not_found' };
  if ((parentBySlug.get(parentSlug) ?? null) !== null) return { ok: false, reason: 'too_deep' };
  if (hasChildren) return { ok: false, reason: 'would_orphan_children' };
  return { ok: true };
}
