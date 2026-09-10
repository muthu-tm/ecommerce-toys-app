import { describe, expect, it } from 'vitest';

import { addMinutes, fixedClock, systemClock } from './clock';
import { COLLECTIONS, FIXED_DOCUMENT_IDS, SUBCOLLECTIONS, paths, splitDocumentPath } from './paths';

/**
 * Paths.
 *
 * These tests look tautological — `paths.product('a')` returns `'products/a'` — and
 * they are not. A mistyped collection name in Firestore does not error: it reads an
 * empty collection and writes a new one. So the value asserted here is the string a
 * security rule's `match /products/{id}` has to agree with, and pinning it is the
 * only thing that makes a rename a test failure rather than a silently empty feed.
 */

describe('collection names', () => {
  it('are all distinct', () => {
    const names = Object.values(COLLECTIONS);
    expect(new Set(names).size).toBe(names.length);
  });

  it('are camelCase, matching the rules file', () => {
    for (const name of Object.values(COLLECTIONS)) {
      expect(name).toMatch(/^[a-z][A-Za-z]*$/);
    }
  });
});

describe('document paths', () => {
  it('builds top-level document paths', () => {
    expect(paths.product('wooden-blocks')).toBe('products/wooden-blocks');
    expect(paths.category('wooden')).toBe('categories/wooden');
    expect(paths.warehouse('blr')).toBe('warehouses/blr');
    expect(paths.order('order-1')).toBe('orders/order-1');
    expect(paths.cart('uid-1')).toBe('carts/uid-1');
    expect(paths.user('uid-1')).toBe('users/uid-1');
    expect(paths.review('review-1')).toBe('reviews/review-1');
    expect(paths.refund('refund-1')).toBe('refunds/refund-1');
    expect(paths.event('event-1')).toBe('events/event-1');
    expect(paths.notification('note-1')).toBe('notifications/note-1');
    expect(paths.reservation('res-1')).toBe('reservations/res-1');
    expect(paths.ledgerEntry('entry-1')).toBe('inventoryLedger/entry-1');
    expect(paths.counter('orderHumanId')).toBe('counters/orderHumanId');
  });

  it('keys inventory by variant, so a checkout touches one document per line', () => {
    expect(paths.inventory('WB-240')).toBe('inventory/WB-240');
  });

  it('builds subcollection paths under their parent', () => {
    expect(paths.variants('wooden-blocks')).toBe('products/wooden-blocks/variants');
    expect(paths.variant('wooden-blocks', 'WB-240')).toBe('products/wooden-blocks/variants/WB-240');
    expect(paths.addresses('uid-1')).toBe('users/uid-1/addresses');
    expect(paths.address('uid-1', 'addr-1')).toBe('users/uid-1/addresses/addr-1');
    expect(paths.wishlist('uid-1')).toBe('users/uid-1/wishlist');
    expect(paths.wishlistItem('uid-1', 'wooden-blocks')).toBe('users/uid-1/wishlist/wooden-blocks');
    expect(paths.orderEvents('order-1')).toBe('orders/order-1/events');
    expect(paths.orderEvent('order-1', 'ev-1')).toBe('orders/order-1/events/ev-1');
  });

  it('keeps the per-order audit trail separate from the store-wide spine', () => {
    // Same subcollection name, different collections: `orders/{id}/events` is
    // customer-readable, `events` is staff-only. Confusing them would expose the
    // internal spine.
    expect(paths.orderEvent('order-1', 'ev-1')).not.toBe(paths.event('ev-1'));
  });

  it('resolves the fixed singleton documents', () => {
    expect(paths.settings('checkout')).toBe('settings/checkout');
    expect(paths.checkoutSettings()).toBe('settings/checkout');
    expect(paths.orderHumanIdCounter()).toBe('counters/orderHumanId');
    expect(FIXED_DOCUMENT_IDS.checkoutSettings).toBe('checkout');
  });

  it('nests the daily analytics rollup under a parent document', () => {
    // Four segments, not three. `analytics/daily/{date}` as written in DATA_MODEL.md
    // is a collection path, so it cannot address a rollup document at all.
    expect(paths.dailyAnalytics('2026-03-01')).toBe('analytics/rollups/daily/2026-03-01');
    expect(splitDocumentPath(paths.dailyAnalytics('2026-03-01'))).toHaveLength(4);
  });

  it('keys the server-only guards by their normalised natural key', () => {
    expect(paths.identityIndexEntry('asha@example.com')).toBe('identityIndex/asha@example.com');
    expect(paths.paymentRefGuard('412398765432')).toBe('paymentRefGuards/412398765432');
  });

  it('exposes every subcollection name it uses', () => {
    expect(SUBCOLLECTIONS.variants).toBe('variants');
    expect(SUBCOLLECTIONS.orderEvents).toBe('events');
  });
});

describe('splitDocumentPath', () => {
  it('splits a two-segment path', () => {
    expect(splitDocumentPath('products/abc')).toEqual(['products', 'abc']);
  });

  it('splits a four-segment path', () => {
    expect(splitDocumentPath('products/abc/variants/def')).toEqual([
      'products',
      'abc',
      'variants',
      'def',
    ]);
  });

  it('tolerates a leading or trailing slash', () => {
    expect(splitDocumentPath('/products/abc/')).toEqual(['products', 'abc']);
  });

  it('refuses a collection path', () => {
    // Otherwise this surfaces from deep inside the SDK as "Value for argument
    // documentPath must point to a document".
    expect(() => splitDocumentPath('products')).toThrow(TypeError);
    expect(() => splitDocumentPath('products/abc/variants')).toThrow(/even number of segments/);
  });

  it('refuses an empty path', () => {
    expect(() => splitDocumentPath('')).toThrow(TypeError);
    expect(() => splitDocumentPath('///')).toThrow(TypeError);
  });
});

describe('the clock seam', () => {
  it('returns a moving instant from the system clock', () => {
    const before = Date.now();
    const now = systemClock.now();

    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('returns the same instant every time from a fixed clock', () => {
    // This is what makes the seed re-runnable and a TTL assertion an equality check
    // rather than a range with a tolerance.
    const clock = fixedClock(new Date('2026-03-01T09:30:00.000Z'));

    expect(clock.now().toISOString()).toBe('2026-03-01T09:30:00.000Z');
    expect(clock.now().toISOString()).toBe(clock.now().toISOString());
  });

  it('hands out a fresh Date, so a caller cannot mutate the fixed instant', () => {
    const clock = fixedClock(new Date('2026-03-01T09:30:00.000Z'));
    const first = clock.now();
    first.setFullYear(1999);

    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('adds whole minutes', () => {
    expect(addMinutes(new Date('2026-03-01T09:30:00.000Z'), 30).toISOString()).toBe(
      '2026-03-01T10:00:00.000Z',
    );
  });

  it('handles a negative offset and a zero offset', () => {
    expect(addMinutes(new Date('2026-03-01T09:30:00.000Z'), -30).toISOString()).toBe(
      '2026-03-01T09:00:00.000Z',
    );
    expect(addMinutes(new Date('2026-03-01T09:30:00.000Z'), 0).toISOString()).toBe(
      '2026-03-01T09:30:00.000Z',
    );
  });

  it('refuses a non-finite offset', () => {
    expect(() => addMinutes(new Date(), Number.NaN)).toThrow(TypeError);
  });
});
