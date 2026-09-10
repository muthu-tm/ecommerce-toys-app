import { describe, expect, it } from 'vitest';

import { applyStockDelta, stockThresholdCrossing } from './inventory';

/**
 * The inventory-adjustment arithmetic and its two refusals.
 *
 * These are the rules a balance can never break — negative warehouse stock, and on-hand below
 * what reservations hold — so they are asserted directly rather than only observed against the
 * emulator, where an off-by-one is a customer buying stock that does not exist.
 */

describe('applyStockDelta', () => {
  it('adds stock to a warehouse and sums the total', () => {
    const result = applyStockDelta({ blr: 10 }, 'blr', 5, 0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.stock).toEqual({ blr: 15 });
      expect(result.next.onHandTotal).toBe(15);
    }
  });

  it('creates a warehouse entry on a first positive adjustment', () => {
    const result = applyStockDelta({ blr: 10 }, 'del', 8, 0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.stock).toEqual({ blr: 10, del: 8 });
      expect(result.next.onHandTotal).toBe(18);
    }
  });

  it('drops a warehouse key when its stock returns to exactly zero', () => {
    const result = applyStockDelta({ blr: 10, del: 4 }, 'del', -4, 0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.stock).toEqual({ blr: 10 });
      expect(result.next.onHandTotal).toBe(10);
    }
  });

  it('refuses a delta that would take a warehouse negative', () => {
    const result = applyStockDelta({ blr: 3 }, 'blr', -5, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('negative_warehouse_stock');
  });

  it('refuses a delta that would take on-hand below reserved (oversell)', () => {
    // 10 on hand, 8 reserved. Removing 5 would leave 5 on hand for 8 reserved.
    const result = applyStockDelta({ blr: 10 }, 'blr', -5, 8);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('oversell');
  });

  it('allows removing down to exactly the reserved level', () => {
    const result = applyStockDelta({ blr: 10 }, 'blr', -2, 8);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.onHandTotal).toBe(8);
  });
});

describe('stockThresholdCrossing', () => {
  it('emits low_stock when available falls to the threshold from above', () => {
    expect(stockThresholdCrossing({ available: 6 }, { available: 5 }, 5)).toBe('low_stock');
  });

  it('emits out_of_stock when available reaches zero from above', () => {
    expect(stockThresholdCrossing({ available: 2 }, { available: 0 }, 5)).toBe('out_of_stock');
  });

  it('prefers out_of_stock over low_stock when both would apply', () => {
    expect(stockThresholdCrossing({ available: 3 }, { available: 0 }, 5)).toBe('out_of_stock');
  });

  it('does not re-emit while already below the threshold', () => {
    // Was 3 (below 5), now 2 (still below): no crossing, so no event.
    expect(stockThresholdCrossing({ available: 3 }, { available: 2 }, 5)).toBeNull();
  });

  it('does not emit on a restock that stays above the threshold', () => {
    expect(stockThresholdCrossing({ available: 10 }, { available: 20 }, 5)).toBeNull();
  });
});
