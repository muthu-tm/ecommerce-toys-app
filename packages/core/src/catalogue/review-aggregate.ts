/**
 * The pure logic behind a product's denormalised rating aggregate.
 *
 * `products.ratingAvg` and `ratingCount` are a materialised summary of the reviews that
 * count — only `published` ones (`RATING_COUNTED_STATUSES`). Firestore cannot average a
 * query, so exactly one writer keeps the pair true: the review-write trigger, on any
 * `reviews/{id}` write. This is the arithmetic that writer applies, kept pure and out of
 * the transaction so a wrong average is a unit-test failure rather than a mislabelled
 * product page.
 *
 * A mean cannot be maintained with `FieldValue.increment` the way a count can, so the
 * aggregate is recomputed from the current stored pair plus a signed delta: the count
 * moves by ±1 (or 0), and a running sum of stars moves with it. The caller reconstructs
 * the current sum from `ratingAvg × ratingCount`, applies the delta here, and writes the
 * rounded result back — all inside the transaction that reads the product, so two reviews
 * landing at once cannot race to a stale average.
 *
 * `@romp/data`'s review-write applies this; nothing here touches Firestore.
 */

/** A review, reduced to the two facts that decide whether and how much it counts. */
export interface CountableReview {
  /** True only for a `published` review — the sole status in `RATING_COUNTED_STATUSES`. */
  readonly counted: boolean;
  /** The star rating, 1–5. Ignored when `counted` is false. */
  readonly rating: number;
}

/** The signed change a single review write makes to a product's aggregate. */
export interface RatingAggregateDelta {
  /** Change to `ratingCount`: +1 on publish, −1 on un-publish, 0 otherwise. */
  readonly countDelta: number;
  /** Change to the running sum of stars, from which the new average is derived. */
  readonly sumDelta: number;
}

/** A product's current rating aggregate, and the recomputed result after a delta. */
export interface RatingAggregate {
  readonly ratingCount: number;
  /** One decimal place; 0 when there are no counted reviews. */
  readonly ratingAvg: number;
}

/**
 * The aggregate delta a single review write implies.
 *
 * Only a `published` review contributes, so the change is the difference between the
 * before and after contribution: a review reaching `published` is +1 and +its stars, a
 * review leaving `published` (rejected or pulled back to pending) is −1 and −its stars,
 * a rating edited while published is 0 count and the star difference, and any write that
 * was not published on either side is a no-op. Comparing contributions rather than
 * branching on the transition means an edit that both changes the rating and the status
 * is handled by the same subtraction.
 */
export function planRatingAggregateChange(
  before: CountableReview | null,
  after: CountableReview | null,
): RatingAggregateDelta {
  const beforeCounted = before?.counted ?? false;
  const afterCounted = after?.counted ?? false;

  const beforeCount = beforeCounted ? 1 : 0;
  const afterCount = afterCounted ? 1 : 0;
  const beforeSum = beforeCounted ? (before?.rating ?? 0) : 0;
  const afterSum = afterCounted ? (after?.rating ?? 0) : 0;

  return { countDelta: afterCount - beforeCount, sumDelta: afterSum - beforeSum };
}

/**
 * Recomputes a product's rating aggregate from its current pair and a signed delta.
 *
 * The current running sum is reconstructed as `round(ratingAvg × ratingCount)` — the
 * stored average is one decimal, so the product is not exact, but rounding recovers the
 * integer sum of whole-star ratings it came from. The delta is applied to both count and
 * sum, the count is floored at zero as a defensive guard against a double-applied
 * decrement (an at-least-once retry), and the new average is the sum over the count
 * rounded to one decimal — or exactly 0 when nothing counts, which is the value the
 * product schema requires for a zero count.
 */
export function applyRatingAggregateDelta(
  current: RatingAggregate,
  delta: RatingAggregateDelta,
): RatingAggregate {
  const currentSum = Math.round(current.ratingAvg * current.ratingCount);

  const ratingCount = Math.max(0, current.ratingCount + delta.countDelta);
  const sum = Math.max(0, currentSum + delta.sumDelta);

  if (ratingCount === 0) return { ratingCount: 0, ratingAvg: 0 };

  const ratingAvg = Math.round((sum / ratingCount) * 10) / 10;
  return { ratingCount, ratingAvg };
}
