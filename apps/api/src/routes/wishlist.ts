import type { FastifyRequest } from 'fastify';

import { addToWishlist, removeFromWishlist } from '@romp/data';
import { NotFoundError } from '@romp/observability';
import storeConfig from '@romp/store-config/generated/store-config.json';

import type { RompApp } from '../app';
import { requireAuthHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';

/**
 * The wishlist routes — the API-owned write half of the wishlist subcollection.
 *
 * The heart on a product page reads `users/{uid}/wishlist/{productId}` directly under the rules; the
 * toggle goes through here so the server can confirm the product exists before saving a reference to
 * it. Both operations are idempotent by the product-keyed document, so a double-tap is safe.
 *
 * The whole feature is behind the `wishlist` flag: a store with it off has no wishlist UI **and** no
 * wishlist routes — a disabled feature refuses at the server contract, not only in the client, so
 * the flag cannot be defeated by calling the API directly. The refusal is a 404, the same
 * non-disclosure a hidden resource gets.
 */
export function registerWishlistRoutes(app: RompApp): void {
  const { context } = app.deps;
  const enabled = storeConfig.features.wishlist;

  const guardFeature = (): void => {
    if (!enabled) {
      throw NotFoundError.forHiddenResource('wishlist', { reason: 'feature_disabled' });
    }
  };

  const limit = (request: FastifyRequest): void => {
    app.rateLimiter.consume(rateLimitKey(request, 'accountWrite'), RATE_LIMITS.accountWrite);
  };

  // --- add to wishlist (idempotent) ---------------------------------------
  app.put('/v1/wishlist/:productId', { preHandler: requireAuthHook }, async (request, reply) => {
    guardFeature();
    limit(request);
    const { productId } = request.params as { productId: string };

    await addToWishlist(context, request.caller, productId);
    return reply.code(204).send();
  });

  // --- remove from wishlist (idempotent) ----------------------------------
  app.delete('/v1/wishlist/:productId', { preHandler: requireAuthHook }, async (request, reply) => {
    guardFeature();
    limit(request);
    const { productId } = request.params as { productId: string };

    await removeFromWishlist(context, request.caller, productId);
    return reply.code(204).send();
  });
}
