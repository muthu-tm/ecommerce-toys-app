import { describe, expect, it } from 'vitest';

import {
  BASIS_POINTS_SCALE,
  BasisPointsSchema,
  GST_BANDS,
  basisPoints,
  formatBasisPoints,
} from './basis-points';

describe('BasisPointsSchema', () => {
  it('accepts the Indian GST bands', () => {
    expect(Object.values(GST_BANDS)).toEqual([0, 500, 1_200, 1_800, 2_800]);
  });

  it('accepts the bounds', () => {
    expect(basisPoints(0)).toBe(0);
    expect(basisPoints(BASIS_POINTS_SCALE)).toBe(10_000);
  });

  it('rejects a rate above 100 percent', () => {
    // A rate over 100% is a misplaced decimal, not a tax band, and it should fail
    // at the boundary rather than produce a total nobody will pay.
    expect(() => basisPoints(10_001)).toThrow();
  });

  it('rejects a negative or fractional rate', () => {
    expect(() => basisPoints(-1)).toThrow();
    expect(() => basisPoints(18.5)).toThrow();
  });

  it('explains what a basis point is when given a decimal rate', () => {
    // The likely mistake is passing 0.18 for 18%.
    const result = BasisPointsSchema.safeParse(0.18);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/basis points/);
  });
});

describe('formatBasisPoints', () => {
  it('renders whole percentages without decimals', () => {
    expect(formatBasisPoints(GST_BANDS.eighteenPercent)).toBe('18%');
    expect(formatBasisPoints(GST_BANDS.exempt)).toBe('0%');
    expect(formatBasisPoints(GST_BANDS.twentyEightPercent)).toBe('28%');
  });

  it('renders a fractional percentage to two decimals', () => {
    expect(formatBasisPoints(basisPoints(1_850))).toBe('18.50%');
    expect(formatBasisPoints(basisPoints(1))).toBe('0.01%');
  });

  it('renders the full scale', () => {
    expect(formatBasisPoints(basisPoints(BASIS_POINTS_SCALE))).toBe('100%');
  });
});
