import { describe, expect, it } from 'vitest';

import { cacheTags, tagsForProduct } from './cache-tags';

/**
 * The shared cache-tag vocabulary.
 *
 * The value of this module is that a read and a write build the *same* string for the same
 * thing — so these assert the exact tag strings, because a rename that looked harmless would
 * silently serve a stale page forever.
 */

describe('cacheTags', () => {
  it('builds the fine-grained tags', () => {
    expect(cacheTags.product('wooden-blocks')).toBe('product:wooden-blocks');
    expect(cacheTags.category('building-sets')).toBe('category:building-sets');
    expect(cacheTags.ageBand('6-8')).toBe('age:6-8');
  });

  it('exposes the coarse tags as constants', () => {
    expect(cacheTags.catalogue).toBe('catalogue');
    expect(cacheTags.categories).toBe('categories');
  });
});

describe('tagsForProduct', () => {
  it('busts the product page, its category and age listings, and the coarse catalogue tag', () => {
    const tags = tagsForProduct({
      slug: 'wooden-blocks',
      categorySlug: 'building-sets',
      ageBand: '6-8',
    });

    expect(tags).toEqual([
      'product:wooden-blocks',
      'category:building-sets',
      'age:6-8',
      'catalogue',
    ]);
  });
});
