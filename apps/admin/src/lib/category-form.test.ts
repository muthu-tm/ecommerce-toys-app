import { describe, expect, it } from 'vitest';

import type { CategoryDoc } from '@romp/contracts';
import { aCategory } from '@romp/contracts/fixtures';
import type { WithId } from '@romp/data';

import {
  buildCategoryTree,
  categoryDocToFormState,
  EMPTY_CATEGORY_FORM,
  toCreateCategoryRequest,
  toUpdateCategoryRequest,
} from './category-form';

/**
 * The pure category form logic: mapping form state to API requests and grouping the flat list
 * into the one-level tree the manager renders. Tested here so the component stays a thin
 * binding over it.
 */

function category(overrides: Partial<CategoryDoc> & { id: string }): WithId<CategoryDoc> {
  const { id, ...rest } = overrides;
  return { ...aCategory(rest), id };
}

describe('toCreateCategoryRequest', () => {
  it('omits an empty slug so the server derives it', () => {
    const request = toCreateCategoryRequest({ ...EMPTY_CATEGORY_FORM, name: 'Wooden toys' });
    expect(request.name).toBe('Wooden toys');
    expect('slug' in request).toBe(false);
    expect(request.parentId).toBeNull();
  });

  it('includes a pinned slug and a parent, and parses the sort order', () => {
    const request = toCreateCategoryRequest({
      ...EMPTY_CATEGORY_FORM,
      name: 'Sensory',
      slug: 'sensory',
      parentId: 'wooden',
      sortOrder: '11',
    });
    expect(request.slug).toBe('sensory');
    expect(request.parentId).toBe('wooden');
    expect(request.sortOrder).toBe(11);
  });

  it('trims the name and falls back to sort order 0 for a blank field', () => {
    const request = toCreateCategoryRequest({
      ...EMPTY_CATEGORY_FORM,
      name: '  Puzzles  ',
      sortOrder: '',
    });
    expect(request.name).toBe('Puzzles');
    expect(request.sortOrder).toBe(0);
  });
});

describe('toUpdateCategoryRequest', () => {
  it('maps the mutable fields and never carries a slug', () => {
    const request = toUpdateCategoryRequest({
      ...EMPTY_CATEGORY_FORM,
      name: 'Renamed',
      slug: 'ignored',
      parentId: 'wooden',
      active: false,
      showInNav: false,
      sortOrder: '5',
    });
    expect(request).toEqual({
      name: 'Renamed',
      parentId: 'wooden',
      active: false,
      showInNav: false,
      showInFilters: true,
      sortOrder: 5,
    });
    expect('slug' in request).toBe(false);
  });
});

describe('categoryDocToFormState', () => {
  it('round-trips a category document into editable form state', () => {
    const state = categoryDocToFormState(
      category({ id: 'sensory', slug: 'sensory' as CategoryDoc['slug'], parentId: 'wooden' as CategoryDoc['parentId'], active: false, sortOrder: 11 }),
    );
    expect(state.slug).toBe('sensory');
    expect(state.parentId).toBe('wooden');
    expect(state.active).toBe(false);
    expect(state.sortOrder).toBe('11');
  });

  it('represents a top-level category with an empty parent', () => {
    const state = categoryDocToFormState(category({ id: 'wooden', parentId: null }));
    expect(state.parentId).toBe('');
  });
});

describe('buildCategoryTree', () => {
  const tree = () => [
    category({ id: 'puzzles', slug: 'puzzles' as CategoryDoc['slug'], parentId: null, sortOrder: 20 }),
    category({ id: 'wooden', slug: 'wooden' as CategoryDoc['slug'], parentId: null, sortOrder: 10 }),
    category({ id: 'sensory', slug: 'sensory' as CategoryDoc['slug'], parentId: 'wooden' as CategoryDoc['parentId'], sortOrder: 11 }),
  ];

  it('groups children under their parent, ordered by sortOrder', () => {
    const nodes = buildCategoryTree(tree());
    expect(nodes.map((n) => n.category.slug)).toEqual(['wooden', 'puzzles']);
    expect(nodes[0]?.children.map((c) => c.slug)).toEqual(['sensory']);
    expect(nodes[1]?.children).toEqual([]);
  });

  it('surfaces a child whose parent is missing as its own top-level node', () => {
    const nodes = buildCategoryTree([
      category({ id: 'orphan', slug: 'orphan' as CategoryDoc['slug'], parentId: 'gone' as CategoryDoc['parentId'], sortOrder: 5 }),
    ]);
    expect(nodes.map((n) => n.category.slug)).toEqual(['orphan']);
    expect(nodes[0]?.children).toEqual([]);
  });

  it('returns an empty tree for no categories', () => {
    expect(buildCategoryTree([])).toEqual([]);
  });
});
