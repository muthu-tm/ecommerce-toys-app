import { describe, expect, it } from 'vitest';

import {
  InventoryLedgerReasonSchema,
  OPERATOR_SELECTABLE_REASONS,
  availableStock,
  quantity,
  quantityDelta,
} from './inventory';

describe('quantity', () => {
  it('accepts a whole number of units, including zero', () => {
    expect(quantity(0)).toBe(0);
    expect(quantity(42)).toBe(42);
  });

  it.each([
    ['a fractional count', 1.5],
    ['a negative count', -1],
  ])('rejects %s', (_label, value) => {
    expect(() => quantity(value)).toThrow();
  });
});

describe('quantityDelta', () => {
  it('allows movement in both directions', () => {
    // Ledger deltas are signed; balances never are.
    expect(quantityDelta(-3)).toBe(-3);
    expect(quantityDelta(3)).toBe(3);
  });

  it('rejects a fractional movement', () => {
    expect(() => quantityDelta(0.5)).toThrow();
  });
});

describe('availableStock', () => {
  it('subtracts what reservations are holding', () => {
    expect(availableStock(10, 3)).toBe(7);
    expect(availableStock(10, 10)).toBe(0);
  });

  it('returns a negative number rather than throwing', () => {
    // This is the condition a caller must detect to refuse a reservation. Forcing
    // it through a non-negative schema would throw before the caller could produce
    // a useful INSUFFICIENT_STOCK message naming what is actually available.
    expect(availableStock(2, 5)).toBe(-3);
  });
});

describe('ledger reasons', () => {
  it('offers operators only the reasons they should choose by hand', () => {
    // The rest are written by the system, in the transaction that caused the move.
    expect([...OPERATOR_SELECTABLE_REASONS]).toEqual(['adjustment', 'reconciliation']);

    for (const reason of OPERATOR_SELECTABLE_REASONS) {
      expect(InventoryLedgerReasonSchema.options).toContain(reason);
    }
  });

  it('covers every movement the system performs', () => {
    for (const reason of [
      'order_committed',
      'order_cancelled',
      'refund_restock',
      'seed',
    ] as const) {
      expect(InventoryLedgerReasonSchema.options).toContain(reason);
    }
  });
});
