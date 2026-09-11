import { describe, expect, it } from 'vitest';

import { money } from '@romp/contracts';

import type { RollupOrder } from './rollup';
import { aggregateDailyOrders, zonedDayWindow } from './rollup';

/**
 * The analytics-rollup arithmetic.
 *
 * Two properties matter. The **day window** has to be the store's local day, not a UTC day, or an
 * 11pm sale in Bengaluru lands on the wrong date; and it has to be half-open, or a midnight order is
 * counted twice. The **aggregation** has to produce a row the `DailyAnalyticsDoc` schema accepts —
 * in particular a zero average when there were no paid orders, which is the invariant the schema
 * refuses to store a carried-forward figure against.
 */

describe('zonedDayWindow', () => {
  it('bounds a day by the store timezone, not UTC (Asia/Kolkata is +05:30)', () => {
    const window = zonedDayWindow('2026-03-01', 'Asia/Kolkata');
    // Local midnight on 2026-03-01 in +05:30 is 18:30 UTC the previous day.
    expect(window.startInclusive.toISOString()).toBe('2026-02-28T18:30:00.000Z');
    expect(window.endExclusive.toISOString()).toBe('2026-03-01T18:30:00.000Z');
  });

  it('is a 24-hour half-open window in a fixed-offset zone', () => {
    const window = zonedDayWindow('2026-03-01', 'Asia/Kolkata');
    const hours = (window.endExclusive.getTime() - window.startInclusive.getTime()) / 3_600_000;
    expect(hours).toBe(24);
  });

  it('handles a UTC store cleanly', () => {
    const window = zonedDayWindow('2026-03-01', 'UTC');
    expect(window.startInclusive.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(window.endExclusive.toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });

  it('rejects a malformed date', () => {
    expect(() => zonedDayWindow('01-03-2026', 'Asia/Kolkata')).toThrow(RangeError);
  });
});

const order = (
  status: RollupOrder['status'],
  totalMinor = 100_000,
  refundedMinor = 0,
): RollupOrder => ({
  status,
  totalMinor: money(totalMinor),
  refundedMinor: money(refundedMinor),
});

describe('aggregateDailyOrders', () => {
  it('counts every order placed, and only paid ones as revenue', () => {
    const rollup = aggregateDailyOrders([
      order('paid', 100_000),
      order('paid', 300_000),
      order('awaiting_payment'),
      order('payment_rejected'),
    ]);

    expect(rollup.orderCount).toBe(4);
    expect(rollup.paidCount).toBe(2);
    expect(rollup.rejectedCount).toBe(1);
    expect(rollup.revenueMinor).toBe(400_000);
    // AOV is revenue over paid orders: 400000 / 2.
    expect(rollup.aovMinor).toBe(200_000);
  });

  it('counts a refunded order as settled revenue and tracks the refund separately', () => {
    const rollup = aggregateDailyOrders([order('refunded', 100_000, 100_000)]);
    expect(rollup.paidCount).toBe(1);
    expect(rollup.revenueMinor).toBe(100_000);
    expect(rollup.refundedMinor).toBe(100_000);
  });

  it('produces a zero average when there were no paid orders', () => {
    // The schema refuses a carried-forward AOV with no sales behind it; this is where zero is made.
    const rollup = aggregateDailyOrders([order('awaiting_payment'), order('payment_rejected')]);
    expect(rollup.paidCount).toBe(0);
    expect(rollup.aovMinor).toBe(0);
    expect(rollup.revenueMinor).toBe(0);
  });

  it('rounds the average to the nearest paise', () => {
    // 3 paid orders totalling 100001 -> 33333.67 -> 33334.
    const rollup = aggregateDailyOrders([
      order('paid', 33_334),
      order('paid', 33_334),
      order('paid', 33_333),
    ]);
    expect(rollup.revenueMinor).toBe(100_001);
    expect(rollup.aovMinor).toBe(33_334);
  });

  it('is all zeroes for a day with no orders', () => {
    const rollup = aggregateDailyOrders([]);
    expect(rollup).toEqual({
      revenueMinor: 0,
      orderCount: 0,
      paidCount: 0,
      rejectedCount: 0,
      refundedMinor: 0,
      aovMinor: 0,
    });
  });
});
