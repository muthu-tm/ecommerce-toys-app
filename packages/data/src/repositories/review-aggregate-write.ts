import type { CountableReview } from '@romp/core';
import { applyRatingAggregateDelta, planRatingAggregateChange } from '@romp/core';

import type { StoreContext } from '../context';
import { converters } from '../converters';
import { paths } from '../paths';

/**
 * Maintains a product's `ratingAvg`/`ratingCount` — the aggregate half of reviews.
 *
 * The pair is a denormalised summary of the product's `published` reviews, and Firestore cannot
 * average a query, so exactly one writer keeps it true: the `reviews/{id}` trigger, which reduces
 * each review write to a before/after `CountableReview` and calls this. The arithmetic is pure
 * (`@romp/core`); this applies it inside a transaction that reads the product first, so two review
 * decisions landing at once cannot race to a stale average.
 *
 * A mean is not incrementable the way a count is, hence the read-modify-write rather than
 * `FieldValue.increment`: the current pair is read, the pure delta is applied, and the recomputed
 * pair is written back. A no-op delta (a submit that stays pending, an edit that does not cross the
 * published boundary) touches nothing, and a review whose product has since been deleted is skipped
 * rather than resurrecting a document.
 */
export async function applyReviewRatingChange(
  ctx: StoreContext,
  productId: string,
  before: CountableReview | null,
  after: CountableReview | null,
): Promise<void> {
  const delta = planRatingAggregateChange(before, after);
  if (delta.countDelta === 0 && delta.sumDelta === 0) return;

  const now = ctx.clock.now();
  const ref = ctx.db.doc(paths.product(productId)).withConverter(converters.products);

  await ctx.db.runTransaction(async (tx) => {
    const product = (await tx.get(ref)).data();
    if (product === undefined) return;

    const next = applyRatingAggregateDelta(
      { ratingCount: product.ratingCount, ratingAvg: product.ratingAvg },
      delta,
    );

    tx.update(ref, { ratingCount: next.ratingCount, ratingAvg: next.ratingAvg, updatedAt: now });
  });
}
