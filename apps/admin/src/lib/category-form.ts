import type {
  CategoryDoc,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@romp/contracts';
import type { WithId } from '@romp/data';

/**
 * The backoffice category form's state and its mapping to the API request, plus the pure
 * tree-building the list view renders from.
 *
 * The form holds strings and booleans — what the inputs produce — and this turns that into the
 * typed request the API validates. It also groups the flat category list (each carrying a
 * `parentId` that is a parent slug) into the one-level tree the manager displays, ordered by
 * `sortOrder`. Keeping all of this pure means the fiddly parts — the optional slug, the
 * parent-or-null, the ordering — are unit-tested without rendering anything.
 */

export interface CategoryFormState {
  readonly name: string;
  /** Optional on create (the server derives it from the name); never editable after. */
  readonly slug: string;
  /** Empty string means "top-level"; otherwise a parent slug. */
  readonly parentId: string;
  readonly active: boolean;
  readonly showInNav: boolean;
  readonly showInFilters: boolean;
  readonly sortOrder: string;
}

export const EMPTY_CATEGORY_FORM: CategoryFormState = {
  name: '',
  slug: '',
  parentId: '',
  active: true,
  showInNav: true,
  showInFilters: true,
  sortOrder: '0',
};

/** The form state for editing an existing category. */
export function categoryDocToFormState(category: WithId<CategoryDoc>): CategoryFormState {
  return {
    name: category.name,
    slug: category.slug,
    parentId: category.parentId ?? '',
    active: category.active,
    showInNav: category.showInNav,
    showInFilters: category.showInFilters,
    sortOrder: String(category.sortOrder),
  };
}

/** A non-negative integer, or 0 when the field is blank or not a number. */
function toSortOrder(value: string): number {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

// The request schemas brand `slug`/`parentId` as `Slug`; the form holds plain strings validated
// by the server, so a cast at this one boundary keeps the form untyped by the brand.
type Slug = CreateCategoryRequest['parentId'] & string;

/** Maps form state to a create request. An empty slug is omitted so the server derives it. */
export function toCreateCategoryRequest(state: CategoryFormState): CreateCategoryRequest {
  const trimmedSlug = state.slug.trim();
  return {
    name: state.name.trim(),
    ...(trimmedSlug === '' ? {} : { slug: trimmedSlug as Slug }),
    parentId: state.parentId === '' ? null : (state.parentId as Slug),
    active: state.active,
    showInNav: state.showInNav,
    showInFilters: state.showInFilters,
    sortOrder: toSortOrder(state.sortOrder),
  };
}

/** Maps form state to an edit request. The slug is immutable and not sent. */
export function toUpdateCategoryRequest(state: CategoryFormState): UpdateCategoryRequest {
  return {
    name: state.name.trim(),
    parentId: state.parentId === '' ? null : (state.parentId as Slug),
    active: state.active,
    showInNav: state.showInNav,
    showInFilters: state.showInFilters,
    sortOrder: toSortOrder(state.sortOrder),
  };
}

/** A top-level category with its children, both ordered by sortOrder. */
export interface CategoryTreeNode {
  readonly category: WithId<CategoryDoc>;
  readonly children: readonly WithId<CategoryDoc>[];
}

/**
 * Groups the flat category list into the one-level tree the manager renders.
 *
 * Top-level categories (null `parentId`) become nodes, each with its children — the categories
 * whose `parentId` is that node's slug — attached and sorted. Both levels are ordered by
 * `sortOrder` then name, so the display order matches the storefront's. A child whose parent is
 * missing from the list is surfaced as its own top-level node rather than hidden, so a broken
 * parent link is visible to an operator instead of silently swallowing the category.
 */
export function buildCategoryTree(
  categories: readonly WithId<CategoryDoc>[],
): readonly CategoryTreeNode[] {
  const bySort = (a: WithId<CategoryDoc>, b: WithId<CategoryDoc>): number =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

  const topLevelSlugs = new Set<string>(
    categories.filter((c) => c.parentId === null).map((c) => c.slug),
  );

  const childrenByParent = new Map<string, WithId<CategoryDoc>[]>();
  const orphans: WithId<CategoryDoc>[] = [];
  for (const category of categories) {
    if (category.parentId === null) continue;
    const parentId: string = category.parentId;
    if (topLevelSlugs.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(category);
      childrenByParent.set(parentId, list);
    } else {
      orphans.push(category);
    }
  }

  const tops = [...categories.filter((c) => c.parentId === null), ...orphans].sort(bySort);

  return tops.map((category) => ({
    category,
    children: [...(childrenByParent.get(category.slug) ?? [])].sort(bySort),
  }));
}
