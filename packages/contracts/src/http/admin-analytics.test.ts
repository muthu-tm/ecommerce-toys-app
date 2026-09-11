import { describe, expect, it } from 'vitest';

import { DailyAnalyticsRangeRequestSchema, DailyAnalyticsResponseSchema } from './admin-analytics';

/**
 * The admin analytics contracts. The concern is the range boundary: both ends are inclusive dates,
 * and a start after its end is a caller error the schema refuses rather than silently returning an
 * empty chart.
 */

describe('DailyAnalyticsRangeRequestSchema', () => {
  it('accepts a well-ordered range', () => {
    expect(
      DailyAnalyticsRangeRequestSchema.safeParse({ from: '2026-03-01', to: '2026-03-31' }).success,
    ).toBe(true);
  });

  it('accepts a single-day range', () => {
    expect(
      DailyAnalyticsRangeRequestSchema.safeParse({ from: '2026-03-01', to: '2026-03-01' }).success,
    ).toBe(true);
  });

  it('rejects a start after its end', () => {
    expect(
      DailyAnalyticsRangeRequestSchema.safeParse({ from: '2026-03-31', to: '2026-03-01' }).success,
    ).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(
      DailyAnalyticsRangeRequestSchema.safeParse({ from: '01-03-2026', to: '2026-03-31' }).success,
    ).toBe(false);
  });
});

describe('DailyAnalyticsResponseSchema', () => {
  const row = {
    date: '2026-03-01',
    revenueMinor: 581_952,
    orderCount: 3,
    paidCount: 2,
    rejectedCount: 1,
    refundedMinor: 0,
    aovMinor: 290_976,
    computedAt: new Date('2026-03-02T00:05:00.000Z'),
  };

  it('accepts a list of rollup rows', () => {
    expect(DailyAnalyticsResponseSchema.safeParse({ days: [row] }).success).toBe(true);
  });

  it('accepts an empty range', () => {
    expect(DailyAnalyticsResponseSchema.safeParse({ days: [] }).success).toBe(true);
  });

  it('rejects a row whose paid count exceeds the order count', () => {
    expect(
      DailyAnalyticsResponseSchema.safeParse({ days: [{ ...row, paidCount: 5 }] }).success,
    ).toBe(false);
  });
});
