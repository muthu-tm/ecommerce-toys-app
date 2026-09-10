import { z } from 'zod';

import { createStateMachine } from '../state-machine';

/** Reviews are held for moderation before they appear. Only `published` is publicly readable. */
export const ReviewStatusSchema = z.enum(['pending', 'published', 'rejected']);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/**
 * `published → pending` exists so a review can be pulled back for re-moderation
 * without deleting it — deletion would lose the author's words and silently change
 * the product's rating with no record of why.
 *
 * `rejected` is terminal, and the customer is deliberately **not** notified.
 * Rejection reasons are usually moderation judgements; surfacing them invites
 * argument and adds nothing. The review simply never appears.
 */
export const reviewStatusMachine = createStateMachine('review status', {
  pending: ['published', 'rejected'],
  published: ['pending', 'rejected'],
  rejected: [],
} satisfies Record<ReviewStatus, readonly ReviewStatus[]>);

/** Statuses that occupy the one-review-per-customer-per-product slot. */
export const REVIEW_SLOT_OCCUPYING_STATUSES: readonly ReviewStatus[] = Object.freeze([
  'pending',
  'published',
]);

/** Statuses that contribute to `products.ratingAvg` and `ratingCount`. */
export const RATING_COUNTED_STATUSES: readonly ReviewStatus[] = Object.freeze(['published']);

export const RatingSchema = z
  .int({ error: 'A rating is a whole number of stars.' })
  .min(1, { error: 'A rating is between 1 and 5 stars.' })
  .max(5, { error: 'A rating is between 1 and 5 stars.' })
  .brand<'Rating'>();
export type Rating = z.infer<typeof RatingSchema>;
