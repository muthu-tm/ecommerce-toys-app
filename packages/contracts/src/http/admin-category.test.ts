import { describe, expect, it } from 'vitest';

import {
  CreateCategoryRequestSchema,
  ReorderCategoriesRequestSchema,
  UpdateCategoryRequestSchema,
} from './admin-category';

/**
 * The backoffice category wire contracts. The concern is the boundary rules a route relies on:
 * the slug is optional on create and absent from edit, the parent is a slug or null, and a
 * reorder cannot list the same category twice.
 */

const createBody = {
  name: 'Wooden toys',
  parentId: null,
  active: true,
  showInNav: true,
  showInFilters: true,
  sortOrder: 10,
};

describe('CreateCategoryRequestSchema', () => {
  it('accepts a body without a slug (the server derives it)', () => {
    expect(CreateCategoryRequestSchema.safeParse(createBody).success).toBe(true);
  });

  it('accepts a pinned slug and a parent slug', () => {
    expect(
      CreateCategoryRequestSchema.safeParse({ ...createBody, slug: 'wooden', parentId: 'toys' })
        .success,
    ).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(CreateCategoryRequestSchema.safeParse({ ...createBody, name: '' }).success).toBe(false);
  });

  it('rejects a malformed slug', () => {
    expect(
      CreateCategoryRequestSchema.safeParse({ ...createBody, slug: 'Not A Slug' }).success,
    ).toBe(false);
  });

  it('rejects a negative sort order', () => {
    expect(CreateCategoryRequestSchema.safeParse({ ...createBody, sortOrder: -1 }).success).toBe(
      false,
    );
  });
});

describe('UpdateCategoryRequestSchema', () => {
  it('accepts the mutable fields', () => {
    expect(
      UpdateCategoryRequestSchema.safeParse({
        name: 'Renamed',
        parentId: 'toys',
        active: false,
        showInNav: false,
        showInFilters: true,
        sortOrder: 5,
      }).success,
    ).toBe(true);
  });

  it('ignores a slug if one is sent — it is immutable and not part of the contract', () => {
    const result = UpdateCategoryRequestSchema.safeParse({
      name: 'Renamed',
      slug: 'attempted-rename',
      parentId: null,
      active: true,
      showInNav: true,
      showInFilters: true,
      sortOrder: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('slug' in result.data).toBe(false);
    }
  });
});

describe('ReorderCategoriesRequestSchema', () => {
  it('accepts a list of slug/sortOrder pairs', () => {
    expect(
      ReorderCategoriesRequestSchema.safeParse({
        orders: [
          { slug: 'wooden', sortOrder: 10 },
          { slug: 'puzzles', sortOrder: 20 },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects the same category appearing twice', () => {
    expect(
      ReorderCategoriesRequestSchema.safeParse({
        orders: [
          { slug: 'wooden', sortOrder: 10 },
          { slug: 'wooden', sortOrder: 20 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects an empty list', () => {
    expect(ReorderCategoriesRequestSchema.safeParse({ orders: [] }).success).toBe(false);
  });
});
