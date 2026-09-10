import { z } from 'zod';

/**
 * A rate in basis points: 1 bps = 0.01%, so 1800 bps = 18%.
 *
 * Indian GST rates are 0, 5, 12, 18 and 28 percent. Stored as integers for the
 * same reason money is (ADR-0004): a rate held as `0.18` is a float, and
 * multiplying a float rate by a float price compounds two representation errors.
 *
 * Capped at 10000 (100%). A rate above 100% is a data-entry error — a misplaced
 * decimal — not a tax band, and it should fail at the boundary rather than
 * produce an order total nobody will pay.
 */
export const BasisPointsSchema = z
  .int({ error: 'A rate must be an integer number of basis points (1800 = 18%).' })
  .min(0, { error: 'A rate cannot be negative.' })
  .max(10_000, { error: 'A rate cannot exceed 10000 basis points (100%).' })
  .brand<'BasisPoints'>();

export type BasisPoints = z.infer<typeof BasisPointsSchema>;

/** One hundred percent, as basis points. The denominator in every rate calculation. */
export const BASIS_POINTS_SCALE = 10_000;

export function basisPoints(value: number): BasisPoints {
  return BasisPointsSchema.parse(value);
}

/**
 * The GST bands in force in India.
 *
 * Named for readability at call sites and in seed data. Not a closed set in the
 * schema — `BasisPointsSchema` accepts any valid rate, because a store may need a
 * cess or a rate change before we ship a new version.
 */
export const GST_BANDS = Object.freeze({
  exempt: basisPoints(0),
  fivePercent: basisPoints(500),
  twelvePercent: basisPoints(1_200),
  eighteenPercent: basisPoints(1_800),
  twentyEightPercent: basisPoints(2_800),
});

/** Renders a rate as a human percentage string, e.g. `1800` → `"18%"`. */
export function formatBasisPoints(rate: BasisPoints): string {
  const percent = rate / 100;
  return `${Number.isInteger(percent) ? percent.toString() : percent.toFixed(2)}%`;
}
