import { describe, expect, it } from 'vitest';

import { basisPoints, GST_BANDS } from './basis-points';
import {
  MoneySchema,
  ZERO_MONEY,
  addMoney,
  addTaxBps,
  allocateProportionally,
  applyTaxBps,
  formatMoney,
  money,
  moneyDelta,
  moneyToRupees,
  multiplyMoney,
  rupeesToMoney,
  subtractMoney,
  sumMoney,
} from './money';

describe('Money construction', () => {
  it('accepts integer paise', () => {
    expect(money(169_999)).toBe(169_999);
    expect(ZERO_MONEY).toBe(0);
  });

  it.each([
    ['a decimal amount', 1699.99],
    ['a tiny fraction', 0.5],
    ['a negative amount', -1],
  ])('rejects %s', (_label, value) => {
    expect(() => money(value)).toThrow();
  });

  it('rejects non-finite values', () => {
    expect(() => money(Number.NaN)).toThrow();
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('reports a usable message when a rupee amount is passed by mistake', () => {
    const result = MoneySchema.safeParse(1699.99);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/integer number of paise/);
  });

  it('allows a signed delta, which Money itself forbids', () => {
    expect(moneyDelta(-500)).toBe(-500);
    expect(() => money(-500)).toThrow();
  });
});

describe('rupee conversion', () => {
  it('round-trips a clean amount', () => {
    expect(moneyToRupees(rupeesToMoney(1699.99))).toBe(1699.99);
  });

  it('is exact for the values floating point gets wrong', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. In paise it is 10 + 20 === 30.
    expect(addMoney(rupeesToMoney(0.1), rupeesToMoney(0.2))).toBe(rupeesToMoney(0.3));
  });

  it('rounds a sub-paise input rather than truncating it', () => {
    // 199.999 is a data-entry error; truncating would understate the price.
    expect(rupeesToMoney(199.999)).toBe(20_000);
  });

  it('rejects a non-finite rupee amount', () => {
    expect(() => rupeesToMoney(Number.NaN)).toThrow(TypeError);
  });
});

describe('arithmetic', () => {
  it('adds and sums', () => {
    expect(addMoney(money(100), money(250), money(1))).toBe(351);
    expect(sumMoney([money(100), money(250)])).toBe(350);
    expect(sumMoney([])).toBe(0);
  });

  it('multiplies by a quantity', () => {
    expect(multiplyMoney(money(169_999), 3)).toBe(509_997);
    expect(multiplyMoney(money(169_999), 0)).toBe(0);
  });

  it('is exact where float multiplication is not', () => {
    // 1699.99 * 3 === 5099.969999999999 as a float.
    expect(moneyToRupees(multiplyMoney(rupeesToMoney(1699.99), 3))).toBe(5099.97);
  });

  it('rejects a fractional or negative quantity', () => {
    expect(() => multiplyMoney(money(100), 1.5)).toThrow(RangeError);
    expect(() => multiplyMoney(money(100), -1)).toThrow(RangeError);
  });

  it('subtracts within bounds', () => {
    expect(subtractMoney(money(500), money(200))).toBe(300);
    expect(subtractMoney(money(500), money(500))).toBe(0);
  });

  it('throws rather than clamping when subtraction would go negative', () => {
    // Clamping would hide a broken caller invariant while giving money away.
    expect(() => subtractMoney(money(200), money(500))).toThrow(RangeError);
  });
});

describe('tax in basis points', () => {
  it('applies a rate', () => {
    expect(applyTaxBps(money(100_000), GST_BANDS.eighteenPercent)).toBe(18_000);
    expect(addTaxBps(money(100_000), GST_BANDS.eighteenPercent)).toBe(118_000);
  });

  it('applies a zero rate', () => {
    expect(applyTaxBps(money(100_000), GST_BANDS.exempt)).toBe(0);
  });

  it('rounds half-up to the nearest paise', () => {
    // 12345 * 1800 / 10000 = 2222.1 → 2222
    expect(applyTaxBps(money(12_345), GST_BANDS.eighteenPercent)).toBe(2_222);
    // 12347 * 500 / 10000 = 617.35 → 617
    expect(applyTaxBps(money(12_347), GST_BANDS.fivePercent)).toBe(617);
    // 10 * 500 / 10000 = 0.5 → 1 (half-up, not banker's rounding)
    expect(applyTaxBps(money(10), GST_BANDS.fivePercent)).toBe(1);
  });

  it('rejects an invalid rate', () => {
    expect(() => applyTaxBps(money(100), basisPoints(10_000))).not.toThrow();
    expect(() => basisPoints(10_001)).toThrow();
    expect(() => basisPoints(-1)).toThrow();
    expect(() => basisPoints(18.5)).toThrow();
  });
});

describe('allocateProportionally', () => {
  it('sums exactly to the total, even when the split is not clean', () => {
    // 100 across three equal lines is 33.33...; naive division loses a paise.
    const parts = allocateProportionally(money(100), [1, 1, 1]);

    expect(parts).toEqual([34, 33, 33]);
    expect(sumMoney(parts)).toBe(100);
  });

  it('weights proportionally', () => {
    const parts = allocateProportionally(money(1_000), [50, 30, 20]);

    expect(parts).toEqual([500, 300, 200]);
    expect(sumMoney(parts)).toBe(1_000);
  });

  it('gives the remainder to the largest discarded fractions', () => {
    // Shares are 14.29, 42.86, 42.86 → floors 14, 42, 42 (98). Two paise remain,
    // and they go to the two biggest fractions, which are lines 2 and 3 — not to
    // the first line just because it comes first.
    const parts = allocateProportionally(money(100), [1, 3, 3]);

    expect(sumMoney(parts)).toBe(100);
    expect(parts).toEqual([14, 43, 43]);
  });

  it('is deterministic when fractions tie', () => {
    const first = allocateProportionally(money(10), [1, 1, 1, 1]);
    const second = allocateProportionally(money(10), [1, 1, 1, 1]);

    expect(first).toEqual(second);
    expect(sumMoney(first)).toBe(10);
  });

  it('spreads evenly when every weight is zero', () => {
    // No signal to allocate on, but it still has to add up.
    const parts = allocateProportionally(money(100), [0, 0, 0]);

    expect(sumMoney(parts)).toBe(100);
  });

  it('handles a single line and a zero total', () => {
    expect(allocateProportionally(money(999), [5])).toEqual([999]);
    expect(allocateProportionally(ZERO_MONEY, [1, 2])).toEqual([0, 0]);
  });

  it('rejects an empty or invalid weight set', () => {
    expect(() => allocateProportionally(money(100), [])).toThrow(RangeError);
    expect(() => allocateProportionally(money(100), [-1, 2])).toThrow(RangeError);
    expect(() => allocateProportionally(money(100), [Number.NaN])).toThrow(RangeError);
  });

  it('never loses or invents a paise across many random splits', () => {
    // The property that actually matters: parts sum to the whole, always.
    for (let seed = 1; seed <= 200; seed += 1) {
      const total = money((seed * 7_919) % 500_000);
      const weights = Array.from(
        { length: (seed % 6) + 1 },
        (_, index) => (seed * (index + 3)) % 97,
      );

      expect(sumMoney(allocateProportionally(total, weights))).toBe(total);
    }
  });
});

describe('formatMoney', () => {
  it('formats paise as rupees with two decimals', () => {
    const formatted = formatMoney(money(169_999), { locale: 'en-IN', currency: 'INR' });

    expect(formatted).toContain('1,699.99');
  });

  it('always shows two decimal places', () => {
    expect(formatMoney(money(100_000), { locale: 'en-IN', currency: 'INR' })).toContain('1,000.00');
  });

  it('honours a different locale and currency, for a second store', () => {
    const formatted = formatMoney(money(169_999), { locale: 'en-US', currency: 'USD' });

    expect(formatted).toBe('$1,699.99');
  });
});
