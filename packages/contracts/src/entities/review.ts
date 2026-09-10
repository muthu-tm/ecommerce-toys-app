import { z } from 'zod';

import { RatingSchema, ReviewStatusSchema } from '../domain/review';
import { OrderIdSchema, ProductIdSchema, UidSchema } from '../primitives/ids';
import { InstantSchema, NullableInstantSchema } from '../primitives/instant';

/**
 * `reviews/{reviewId}`.
 *
 * Only `published` is publicly readable; an author additionally sees their own
 * review in any status, so they can tell that it was received rather than
 * concluding the form is broken.
 *
 * `body` is stored **raw** and escaped at render. React escapes by default and
 * nothing here goes through `dangerouslySetInnerHTML`, so sanitising on write
 * would only destroy the customer's actual words while adding no protection —
 * and a sanitiser that runs on write cannot protect a render path that bypasses
 * escaping anyway.
 */
export const ReviewDocSchema = z
  .object({
    productId: ProductIdSchema,
    userId: UidSchema,
    /** Display name snapshot — a later rename must not rewrite published reviews. */
    authorName: z.string().min(1).max(120),
    rating: RatingSchema,
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(4_000),
    status: ReviewStatusSchema,
    /** True when `orderId` names a paid order containing this product. */
    verifiedPurchase: z.boolean(),
    /** Evidence for the verified flag. Null for an unverified review. */
    orderId: OrderIdSchema.nullable(),

    moderatedBy: UidSchema.nullable(),
    moderatedAt: NullableInstantSchema,
    /**
     * Recorded for the moderation audit but **never shown to the author**.
     * Rejection reasons are usually judgement calls; surfacing them invites
     * argument and adds nothing, so the review simply never appears.
     */
    rejectionReason: z.string().min(1).max(500).nullable(),

    createdAt: InstantSchema,
    updatedAt: InstantSchema,
  })
  .refine((review) => review.verifiedPurchase === (review.orderId !== null), {
    // The badge is a factual claim about a purchase. Without the order reference
    // there is nothing to check it against, so the badge would be unfalsifiable.
    error: 'A verified-purchase badge needs the order that evidences it.',
    path: ['orderId'],
  })
  .refine((review) => (review.moderatedBy === null) === (review.moderatedAt === null), {
    error: 'A moderation decision records both who and when.',
    path: ['moderatedBy'],
  })
  .refine((review) => review.status === 'pending' || review.moderatedBy !== null, {
    error: 'A published or rejected review records the moderator who decided it.',
    path: ['moderatedBy'],
  })
  .refine((review) => review.status !== 'pending' || review.rejectionReason === null, {
    error: 'A pending review has not been rejected, so it carries no rejection reason.',
    path: ['rejectionReason'],
  });
export type ReviewDoc = z.infer<typeof ReviewDocSchema>;

/**
 * The single review status a public query filters on.
 *
 * A value rather than a literal repeated in three places: the storefront query,
 * the security rule and the rules test all have to name the same string.
 */
export const PUBLIC_REVIEW_STATUS = ReviewStatusSchema.parse('published');
