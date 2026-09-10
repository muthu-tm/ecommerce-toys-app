import { describe, expect, it } from 'vitest';

import { money } from '@romp/contracts';
import type { CartItem } from '@romp/contracts';

import { applyCartMutation, cartItemCount, cartSubtotal, mergeCarts } from './cart';
import type { CartMutationContext, VariantSnapshot } from './cart';

/**
 * The pure cart logic: applying a mutation against a fresh availability + price read, and the
 * display helpers. This is where the price and the quantity ceilings are actually enforced —
 * carts are API-written so the browser cannot choose either — so it is tested exhaustively
 * without an emulator.
 */

const NOW = new Date('2026-03-01T09:30:00.000Z');

const snapshot = (overrides: Partial<VariantSnapshot> = {}): VariantSnapshot => ({
  variantId: 'v1',
  productId: 'p1',
  sku: 'SKU-1',
  priceMinor: money(2_00_000),
  nameSnapshot: 'Wooden blocks',
  variantNameSnapshot: '240 pieces',
  imagePathSnapshot: 'products/p1/cover.webp',
  ...overrides,
});

const context = (overrides: Partial<CartMutationContext> = {}): CartMutationContext => ({
  variant: snapshot(),
  available: 10,
  maxQtyPerLine: 20,
  now: NOW,
  ...overrides,
});

function line(
  overrides: { readonly variantId: string } & Partial<Record<string, unknown>>,
): CartItem {
  return {
    productId: 'p1',
    sku: 'SKU-1',
    qty: 1,
    priceMinorSnapshot: money(2_00_000),
    nameSnapshot: 'Wooden blocks',
    variantNameSnapshot: '240 pieces',
    imagePathSnapshot: null,
    addedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as CartItem;
}

describe('applyCartMutation — add', () => {
  it('adds a new line at the requested quantity', () => {
    const result = applyCartMutation([], { kind: 'add', variantId: 'v1', qty: 2 }, context());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.qty).toBe(2);
      expect(result.items[0]?.addedAt).toEqual(NOW);
    }
  });

  it('sums onto an existing line and preserves its addedAt', () => {
    const existing = line({ variantId: 'v1', qty: 3 });
    const result = applyCartMutation(
      [existing],
      { kind: 'add', variantId: 'v1', qty: 2 },
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.qty).toBe(5);
      expect(result.items[0]?.addedAt).toEqual(existing.addedAt);
    }
  });

  it('refreshes the price snapshot from the fresh variant', () => {
    const existing = line({ variantId: 'v1', qty: 1, priceMinorSnapshot: money(1_00_000) });
    const result = applyCartMutation(
      [existing],
      { kind: 'add', variantId: 'v1', qty: 1 },
      context({ variant: snapshot({ priceMinor: money(2_50_000) }) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]?.priceMinorSnapshot).toBe(2_50_000);
  });

  it('refuses when the variant is unavailable', () => {
    expect(
      applyCartMutation([], { kind: 'add', variantId: 'v1', qty: 1 }, context({ variant: null })),
    ).toEqual({ ok: false, reason: 'variant_unavailable' });
    expect(
      applyCartMutation([], { kind: 'add', variantId: 'v1', qty: 1 }, context({ available: 0 })),
    ).toEqual({ ok: false, reason: 'variant_unavailable' });
  });

  it('refuses when the summed quantity exceeds available stock', () => {
    const existing = line({ variantId: 'v1', qty: 8 });
    expect(
      applyCartMutation(
        [existing],
        { kind: 'add', variantId: 'v1', qty: 5 },
        context({ available: 10 }),
      ),
    ).toEqual({ ok: false, reason: 'qty_exceeds_available' });
  });

  it('refuses when the quantity exceeds the per-line ceiling, before the stock check', () => {
    expect(
      applyCartMutation(
        [],
        { kind: 'add', variantId: 'v1', qty: 25 },
        context({ available: 100, maxQtyPerLine: 20 }),
      ),
    ).toEqual({ ok: false, reason: 'qty_exceeds_max' });
  });
});

describe('applyCartMutation — set', () => {
  it('replaces the quantity rather than summing', () => {
    const existing = line({ variantId: 'v1', qty: 8 });
    const result = applyCartMutation(
      [existing],
      { kind: 'set', variantId: 'v1', qty: 3 },
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]?.qty).toBe(3);
  });

  it('refuses a set above available', () => {
    expect(
      applyCartMutation([], { kind: 'set', variantId: 'v1', qty: 11 }, context({ available: 10 })),
    ).toEqual({ ok: false, reason: 'qty_exceeds_available' });
  });
});

describe('applyCartMutation — remove', () => {
  it('drops the line', () => {
    const result = applyCartMutation(
      [line({ variantId: 'v1' }), line({ variantId: 'v2' })],
      { kind: 'remove', variantId: 'v1' },
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items.map((i) => i.variantId)).toEqual(['v2']);
  });

  it('is a no-op for an absent line (no variant read needed)', () => {
    const result = applyCartMutation(
      [line({ variantId: 'v2' })],
      { kind: 'remove', variantId: 'gone' },
      context({ variant: null }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items).toHaveLength(1);
  });
});

describe('cartSubtotal and cartItemCount', () => {
  it('sums quantity times price across lines', () => {
    const items = [
      line({ variantId: 'v1', qty: 2, priceMinorSnapshot: money(1_00_000) }),
      line({ variantId: 'v2', qty: 3, priceMinorSnapshot: money(50_000) }),
    ];
    expect(cartSubtotal(items)).toBe(3_50_000);
    expect(cartItemCount(items)).toBe(5);
  });

  it('is zero for an empty cart', () => {
    expect(cartSubtotal([])).toBe(0);
    expect(cartItemCount([])).toBe(0);
  });
});

describe('mergeCarts', () => {
  const avail = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it('sums quantities for a shared variant, capped at available', () => {
    const user = [line({ variantId: 'v1', qty: 3 })];
    const anon = [line({ variantId: 'v1', qty: 5 })];
    const merged = mergeCarts(user, anon, avail({ v1: 6 }), 20);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.qty).toBe(6); // 3 + 5 = 8, capped at 6 available
  });

  it('caps a merged quantity at the per-line ceiling', () => {
    const merged = mergeCarts(
      [line({ variantId: 'v1', qty: 15 })],
      [line({ variantId: 'v1', qty: 15 })],
      avail({ v1: 100 }),
      20,
    );
    expect(merged[0]?.qty).toBe(20);
  });

  it('adds a guest-only variant, dropping one that is out of stock', () => {
    const merged = mergeCarts(
      [line({ variantId: 'v1', qty: 1 })],
      [line({ variantId: 'v2', qty: 2 }), line({ variantId: 'v3', qty: 1 })],
      avail({ v1: 10, v2: 10 }), // v3 absent → out of stock, dropped
      20,
    );
    expect(merged.map((i) => i.variantId).sort()).toEqual(['v1', 'v2']);
    expect(merged.find((i) => i.variantId === 'v2')?.qty).toBe(2);
  });

  it('keeps the user cart snapshots when both have the variant', () => {
    const user = [line({ variantId: 'v1', qty: 1, nameSnapshot: 'User name' })];
    const anon = [line({ variantId: 'v1', qty: 1, nameSnapshot: 'Guest name' })];
    const merged = mergeCarts(user, anon, avail({ v1: 10 }), 20);
    expect(merged[0]?.nameSnapshot).toBe('User name');
    expect(merged[0]?.qty).toBe(2);
  });
});
