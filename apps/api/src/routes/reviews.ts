import type { FastifyRequest } from 'fastify';

import type { OwnReviewListResponse, ReviewDoc, ReviewSubmitResponse } from '@romp/contracts';
import { ReviewSubmitRequestSchema } from '@romp/contracts';
import type { WithId } from '@romp/data';
import { getUser, listOwnReviews, submitReview } from '@romp/data';
import { InternalError, parseOrThrow } from '@romp/observability';

import type { RompApp } from '../app';
import { requireAuthHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireUser } from '../request-context';

/**
 * The customer's review routes — the API-owned write half of the `reviews` collection.
 *
 * A customer reads published reviews (and their own, in any status) straight from Firestore under
 * the rules, but a submission goes through here because the server derives what a client must not
 * assert: the verified-purchase badge (read from the customer's paid orders) and the `pending`
 * status every review starts in. The author-name snapshot is read from the account here so a later
 * rename never rewrites a published review.
 */
export function registerReviewRoutes(app: RompApp): void {
  const { context } = app.deps;

  const limit = (request: FastifyRequest): void => {
    // The submit ceiling is deliberately low (a handful a day): a customer writes few reviews, and
    // a flood is either abuse or a runaway client.
    app.rateLimiter.consume(rateLimitKey(request, 'review'), RATE_LIMITS.review);
  };

  // --- submit a review (held pending for moderation) ----------------------
  app.post('/v1/reviews', { preHandler: requireAuthHook }, async (request, reply) => {
    const uid = requireUser(request);
    limit(request);
    const body = parseOrThrow(ReviewSubmitRequestSchema, request.body);

    // The author-name snapshot is the account's current display name, captured at submit time.
    const user = await getUser(context, request.caller, uid);

    const { id } = await submitReview(
      context,
      request.caller,
      uid,
      {
        productId: body.productId,
        rating: body.rating,
        title: body.title,
        body: body.body,
      },
      user.displayName,
    );

    // Re-read the created review so the response reflects the server-derived verified-purchase badge
    // and the exact stored timestamp, rather than reconstructing them here.
    const own = await listOwnReviews(context, request.caller, uid);
    const created = own.find((review) => review.id === id);
    if (created === undefined) {
      throw new InternalError('A review was created but could not be read back.', {
        context: { resource: 'review', id },
      });
    }
    const response: ReviewSubmitResponse = toOwnReviewView(created);
    return reply.code(201).send(response);
  });

  // --- the customer's own reviews, any status -----------------------------
  app.get('/v1/account/reviews', { preHandler: requireAuthHook }, async (request, reply) => {
    const uid = requireUser(request);
    const reviews = await listOwnReviews(context, request.caller, uid);
    const response: OwnReviewListResponse = { reviews: reviews.map(toOwnReviewView) };
    return reply.send(response);
  });
}

/** Projects a stored review to the author's own view — the public fields plus the status. */
export function toOwnReviewView(review: WithId<ReviewDoc>): ReviewSubmitResponse {
  return {
    id: review.id as ReviewSubmitResponse['id'],
    productId: review.productId,
    authorName: review.authorName,
    rating: review.rating,
    title: review.title,
    body: review.body,
    verifiedPurchase: review.verifiedPurchase,
    status: review.status,
    createdAt: review.createdAt,
  };
}
