import { describe, expect, it } from 'vitest';

import { applyRatingAggregateDelta, planRatingAggregateChange } from './review-aggregate';
import type { CountableReview, RatingAggregate } from './review-aggregate';

/**
 * The pure rating-aggregate arithmetic: how a single review write moves a product's
 * `ratingCount`/`ratingAvg`, and how those are recomputed from the current pair. Exercised
 * without an emulator, because a wrong average is a product page lying about its stars and a
 * transaction test would only catch it by luck.
 */

const published = (rating: number): CountableReview => ({ counted: true, rating });
const hidden = (rating: number): CountableReview => ({ counted: false, rating });

describe('planRatingAggregateChange', () => {
  it('adds one and the stars when a review is first published', () => {
    expect(planRatingAggregateChange(null, published(4))).toEqual({ countDelta: 1, sumDelta: 4 });
  });

  it('adds nothing when a review is submitted but still pending', () => {
    expect(planRatingAggregateChange(null, hidden(5))).toEqual({ countDelta: 0, sumDelta: 0 });
  });

  it('subtracts one and the stars when a published review is rejected', () => {
    expect(planRatingAggregateChange(published(3), hidden(3))).toEqual({
      countDelta: -1,
      sumDelta: -3,
    });
  });

  it('subtracts when a published review is pulled back to pending', () => {
    expect(planRatingAggregateChange(published(5), hidden(5))).toEqual({
      countDelta: -1,
      sumDelta: -5,
    });
  });

  it('moves only the sum when the rating is edited while published', () => {
    expect(planRatingAggregateChange(published(2), published(5))).toEqual({
      countDelta: 0,
      sumDelta: 3,
    });
  });

  it('is a no-op when the review was not counted on either side', () => {
    expect(planRatingAggregateChange(hidden(1), hidden(4))).toEqual({ countDelta: 0, sumDelta: 0 });
  });

  it('subtracts everything when a published review is deleted', () => {
    expect(planRatingAggregateChange(published(4), null)).toEqual({ countDelta: -1, sumDelta: -4 });
  });
});

describe('applyRatingAggregateDelta', () => {
  const empty: RatingAggregate = { ratingCount: 0, ratingAvg: 0 };

  it('sets the first review as the exact average', () => {
    expect(applyRatingAggregateDelta(empty, { countDelta: 1, sumDelta: 4 })).toEqual({
      ratingCount: 1,
      ratingAvg: 4,
    });
  });

  it('rounds the average to one decimal place', () => {
    // Two reviews of 4 and 5 → sum 9 over 2 → 4.5.
    const one = applyRatingAggregateDelta(empty, { countDelta: 1, sumDelta: 4 });
    expect(applyRatingAggregateDelta(one, { countDelta: 1, sumDelta: 5 })).toEqual({
      ratingCount: 2,
      ratingAvg: 4.5,
    });
  });

  it('rounds a repeating average to one decimal', () => {
    // 5, 4, 4 → sum 13 over 3 → 4.333… → 4.3.
    const current: RatingAggregate = { ratingCount: 2, ratingAvg: 4.5 };
    expect(applyRatingAggregateDelta(current, { countDelta: 1, sumDelta: 4 })).toEqual({
      ratingCount: 3,
      ratingAvg: 4.3,
    });
  });

  it('falls to a zero average when the last counted review leaves', () => {
    const current: RatingAggregate = { ratingCount: 1, ratingAvg: 5 };
    expect(applyRatingAggregateDelta(current, { countDelta: -1, sumDelta: -5 })).toEqual(empty);
  });

  it('reconstructs the sum from the stored one-decimal average', () => {
    // Stored 4.3 over 3 reconstructs to sum 13; adding a 5 → 18 over 4 → 4.5.
    const current: RatingAggregate = { ratingCount: 3, ratingAvg: 4.3 };
    expect(applyRatingAggregateDelta(current, { countDelta: 1, sumDelta: 5 })).toEqual({
      ratingCount: 4,
      ratingAvg: 4.5,
    });
  });

  it('floors the count at zero so a double-applied decrement cannot go negative', () => {
    const current: RatingAggregate = { ratingCount: 0, ratingAvg: 0 };
    expect(applyRatingAggregateDelta(current, { countDelta: -1, sumDelta: -4 })).toEqual(empty);
  });

  it('updates the average when a rating is edited in place', () => {
    // One review at 2 (avg 2) edited to 5: countDelta 0, sumDelta 3 → avg 5.
    const current: RatingAggregate = { ratingCount: 1, ratingAvg: 2 };
    expect(applyRatingAggregateDelta(current, { countDelta: 0, sumDelta: 3 })).toEqual({
      ratingCount: 1,
      ratingAvg: 5,
    });
  });
});
