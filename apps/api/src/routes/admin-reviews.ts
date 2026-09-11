import type { FastifyRequest } from 'fastify';

import type { ModerationQueueResponse, ModerationReviewView, ReviewDoc } from '@romp/contracts';
import { ReviewRejectRequestSchema } from '@romp/contracts';
import type { WithId } from '@romp/data';
import { listModerationQueue, moderateReview } from '@romp/data';
import { parseOrThrow } from '@romp/observability';

import type { RompApp } from '../app';
import { requireAdminHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireOperator } from '../request-context';

/**
 * The admin review-moderation routes — the queue and the publish/reject decisions.
 *
 * A review is `pending` until an operator acts, so nothing a customer writes is ever visible without
 * a staff decision. Each decision is attributable and appends to the event spine (the repository
 * does this in the same transaction): publishing routes a notification to the customer; rejecting
 * notifies no one and records a reason for the audit that the author never sees. The rating
 * aggregate is not touched here — the `reviews` trigger reacts to the status change.
 */
export function registerAdminReviewRoutes(app: RompApp): void {
  const { context } = app.deps;

  const limit = (request: FastifyRequest): void => {
    app.rateLimiter.consume(
      rateLimitKey(request, 'adminCatalogueWrite'),
      RATE_LIMITS.adminCatalogueWrite,
    );
  };

  // --- the moderation queue: oldest first ---------------------------------
  app.get('/v1/admin/reviews', { preHandler: requireAdminHook }, async (request, reply) => {
    const operator = requireOperator(request);
    const reviews = await listModerationQueue(context, operator);
    const response: ModerationQueueResponse = { reviews: reviews.map(toModerationReviewView) };
    return reply.send(response);
  });

  // --- publish a review ---------------------------------------------------
  app.post(
    '/v1/admin/reviews/:id/publish',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      const operator = requireOperator(request);
      limit(request);
      const { id: reviewId } = request.params as { id: string };

      await moderateReview(context, operator, reviewId, { action: 'publish' });
      return reply.code(204).send();
    },
  );

  // --- reject a review ----------------------------------------------------
  app.post(
    '/v1/admin/reviews/:id/reject',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      const operator = requireOperator(request);
      limit(request);
      const { id: reviewId } = request.params as { id: string };
      const body = parseOrThrow(ReviewRejectRequestSchema, request.body);

      await moderateReview(context, operator, reviewId, { action: 'reject', reason: body.reason });
      return reply.code(204).send();
    },
  );
}

/** Projects a stored review to the moderation-queue view — the text plus the moderator's context. */
function toModerationReviewView(review: WithId<ReviewDoc>): ModerationReviewView {
  return {
    id: review.id as ModerationReviewView['id'],
    productId: review.productId,
    userId: review.userId,
    authorName: review.authorName,
    rating: review.rating,
    title: review.title,
    body: review.body,
    status: review.status,
    verifiedPurchase: review.verifiedPurchase,
    orderId: review.orderId,
    createdAt: review.createdAt,
  };
}
