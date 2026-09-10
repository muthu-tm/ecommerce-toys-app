import { describe, expect, it } from 'vitest';

import { planProductCountChanges, validateCategoryParent } from './category-write';
import type { CountableProduct } from './category-write';

/**
 * The pure category logic: how a product write moves the denormalised facet counts, and
 * whether a proposed parent keeps the one-level tree legal. Both are exercised without an
 * emulator, because a wrong count or an illegal parent is a customer-facing defect that a
 * transaction test would only find by accident.
 */

// wooden (top) <- sensory (child); puzzles (top). A product under sensory counts for both
// sensory and wooden.
const TREE = new Map<string, string | null>([
  ['wooden', null],
  ['sensory', 'wooden'],
  ['puzzles', null],
]);

const active = (categorySlug: string | null): CountableProduct => ({ categorySlug, active: true });
const draft = (categorySlug: string | null): CountableProduct => ({ categorySlug, active: false });

describe('planProductCountChanges', () => {
  it('adds one to the leaf and every ancestor when an active product is created', () => {
    const deltas = planProductCountChanges(null, active('sensory'), TREE);
    expect(new Map(deltas.map((d) => [d.slug, d.delta]))).toEqual(
      new Map([
        ['sensory', 1],
        ['wooden', 1],
      ]),
    );
  });

  it('counts only the leaf when it is top-level', () => {
    expect(planProductCountChanges(null, active('puzzles'), TREE)).toEqual([
      { slug: 'puzzles', delta: 1 },
    ]);
  });

  it('subtracts up the chain when an active product is deleted', () => {
    const deltas = planProductCountChanges(active('sensory'), null, TREE);
    expect(new Map(deltas.map((d) => [d.slug, d.delta]))).toEqual(
      new Map([
        ['sensory', -1],
        ['wooden', -1],
      ]),
    );
  });

  it('does not count a draft product either before or after', () => {
    expect(planProductCountChanges(null, draft('sensory'), TREE)).toEqual([]);
    expect(planProductCountChanges(draft('sensory'), draft('sensory'), TREE)).toEqual([]);
  });

  it('treats activation as an add and deactivation as a subtract', () => {
    expect(planProductCountChanges(draft('puzzles'), active('puzzles'), TREE)).toEqual([
      { slug: 'puzzles', delta: 1 },
    ]);
    expect(planProductCountChanges(active('puzzles'), draft('puzzles'), TREE)).toEqual([
      { slug: 'puzzles', delta: -1 },
    ]);
  });

  it('moves the count between chains on a recategorisation', () => {
    const deltas = planProductCountChanges(active('sensory'), active('puzzles'), TREE);
    expect(new Map(deltas.map((d) => [d.slug, d.delta]))).toEqual(
      new Map([
        ['sensory', -1],
        ['wooden', -1],
        ['puzzles', 1],
      ]),
    );
  });

  it('keeps the shared ancestor unchanged when moving within its subtree', () => {
    // sensory -> wooden: both chains include wooden, so wooden nets zero and is dropped.
    const deltas = planProductCountChanges(active('sensory'), active('wooden'), TREE);
    expect(new Map(deltas.map((d) => [d.slug, d.delta]))).toEqual(new Map([['sensory', -1]]));
  });

  it('emits nothing when nothing relevant changed', () => {
    expect(planProductCountChanges(active('sensory'), active('sensory'), TREE)).toEqual([]);
  });

  it('does not count a product with no category', () => {
    expect(planProductCountChanges(null, active(null), TREE)).toEqual([]);
  });

  it('treats a slug missing from the tree as top-level rather than looping', () => {
    expect(planProductCountChanges(null, active('deleted-cat'), TREE)).toEqual([
      { slug: 'deleted-cat', delta: 1 },
    ]);
  });
});

describe('validateCategoryParent', () => {
  it('allows making a category top-level (null parent)', () => {
    expect(validateCategoryParent('sensory', null, TREE, false)).toEqual({ ok: true });
  });

  it('allows a top-level parent for a childless category', () => {
    expect(validateCategoryParent('sensory', 'puzzles', TREE, false)).toEqual({ ok: true });
  });

  it('refuses a category as its own parent', () => {
    expect(validateCategoryParent('wooden', 'wooden', TREE, false)).toEqual({
      ok: false,
      reason: 'self_parent',
    });
  });

  it('refuses an unknown parent', () => {
    expect(validateCategoryParent('sensory', 'nope', TREE, false)).toEqual({
      ok: false,
      reason: 'parent_not_found',
    });
  });

  it('refuses a parent that already has a parent (two levels deep)', () => {
    expect(validateCategoryParent('puzzles', 'sensory', TREE, false)).toEqual({
      ok: false,
      reason: 'too_deep',
    });
  });

  it('refuses giving a parent to a category that has children of its own', () => {
    expect(validateCategoryParent('wooden', 'puzzles', TREE, true)).toEqual({
      ok: false,
      reason: 'would_orphan_children',
    });
  });
});
