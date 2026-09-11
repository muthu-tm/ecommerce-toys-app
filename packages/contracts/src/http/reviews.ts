import { z } from 'zod';

import { RatingSchema, ReviewStatusSchema } from '../domain/review';
import { OrderIdSchema, ProductIdSchema, ReviewIdSchema, UidSchema } from '../primitives/ids';
import { InstantSchema } from '../primitives/instant';

/**
 * The review wire contracts.
 *
 * Reviews are client-READ and API-WRITTEN: the storefront reads published reviews (and an author
 * reads their own) straight from Firestore under the rules, but a submission and every moderation
 * decision cross this boundary. The wire views are **projections** — narrower than the stored
 * document — because the two audiences see different things. The public sees a published review with
 * no author identity beyond a display name and no moderation trail; the author additionally sees the
 * status of their own review, so a `pending` one reads as received rather than lost; a moderator sees
 * the whole queue entry. The rejection *reason* is never on any view returned to a customer — it is a
 * moderation note, deliberately not surfaced (`ReviewDoc.rejectionReason`).
 *
 * `body` crosses the wire **raw**. It is escaped at render by React and never reaches
 * `dangerouslySetInnerHTML`, so it is neither sanitised on write nor on serialisation — doing so
 * would only corrupt the customer's words while protecting nothing.
 */

/**
 * Submit a review.
 *
 * The product, a whole-star rating, a title and the body. The server derives everything else: the
 * author-name snapshot from the account, the verified-purchase badge from the customer's paid orders,
 * and the `pending` status every review starts in.
 */
export const ReviewSubmitRequestSchema = z.object({
  productId: ProductIdSchema,
  rating: RatingSchema,
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4_000),
});
export type ReviewSubmitRequest = z.infer<typeof ReviewSubmitRequestSchema>;

/**
 * A published review as the storefront renders it — the public projection.
 *
 * Deliberately narrow: the author's chosen display name, the rating and text, and whether the
 * purchase was verified. No `userId`, no moderation trail, no status (everything here is published by
 * definition), so the shape cannot leak who wrote a review or how it was moderated.
 */
export const PublicReviewViewSchema = z.object({
  id: ReviewIdSchema,
  productId: ProductIdSchema,
  authorName: z.string().min(1).max(120),
  rating: RatingSchema,
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(4_000),
  verifiedPurchase: z.boolean(),
  createdAt: InstantSchema,
});
export type PublicReviewView = z.infer<typeof PublicReviewViewSchema>;

/** Published reviews for a product, newest first — the PDP review list. */
export const ReviewListResponseSchema = z.object({
  reviews: z.array(PublicReviewViewSchema),
});
export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>;

/**
 * A review as its own author sees it — the public projection plus the status.
 *
 * The status is the one thing an author needs that the public does not: a `pending` review reads as
 * received, and a `rejected` one as not shown, without ever surfacing the rejection reason. It is the
 * response of a submission and of the account "your reviews" list.
 */
export const OwnReviewViewSchema = PublicReviewViewSchema.extend({
  status: ReviewStatusSchema,
});
export type OwnReviewView = z.infer<typeof OwnReviewViewSchema>;

/** The result of submitting a review — the author's own view of the pending review just created. */
export const ReviewSubmitResponseSchema = OwnReviewViewSchema;
export type ReviewSubmitResponse = z.infer<typeof ReviewSubmitResponseSchema>;

/** A customer's own reviews across products, any status — the account "your reviews" list. */
export const OwnReviewListResponseSchema = z.object({
  reviews: z.array(OwnReviewViewSchema),
});
export type OwnReviewListResponse = z.infer<typeof OwnReviewListResponseSchema>;

/**
 * A review as the moderation queue shows it.
 *
 * The moderator sees more than the public: the author's uid (to spot a pattern of abuse), the
 * verified-purchase evidence, the status, and the submission time the queue is ordered by. The
 * rejection reason is not here because the queue holds pending reviews, which by definition have
 * none.
 */
export const ModerationReviewViewSchema = z.object({
  id: ReviewIdSchema,
  productId: ProductIdSchema,
  userId: UidSchema,
  authorName: z.string().min(1).max(120),
  rating: RatingSchema,
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(4_000),
  status: ReviewStatusSchema,
  verifiedPurchase: z.boolean(),
  orderId: OrderIdSchema.nullable(),
  createdAt: InstantSchema,
});
export type ModerationReviewView = z.infer<typeof ModerationReviewViewSchema>;

/** The moderation queue, oldest first — the reviews awaiting a decision. */
export const ModerationQueueResponseSchema = z.object({
  reviews: z.array(ModerationReviewViewSchema),
});
export type ModerationQueueResponse = z.infer<typeof ModerationQueueResponseSchema>;

/**
 * Reject a review.
 *
 * The `reason` is recorded for the moderation audit and is required — a rejection with no stated
 * reason is an unaccountable one — but it is never shown to the author (`ReviewDoc.rejectionReason`).
 * Publishing carries no body, so it has no request schema.
 */
export const ReviewRejectRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReviewRejectRequest = z.infer<typeof ReviewRejectRequestSchema>;
