import type { FastifyRequest } from 'fastify';

import { PlaceOrderRequestSchema, SubmitPaymentProofRequestSchema } from '@romp/contracts';
import type {
  OrderView,
  PlaceOrderResponse,
  SubmitPaymentProofResponse,
  OrderDoc,
} from '@romp/contracts';
import {
  EmptyCartError,
  VariantUnavailableError,
  findOrder,
  getCheckoutSettings,
  getUser,
  reserveAndPlaceOrder,
  submitPaymentProof,
} from '@romp/data';
import type { WithId } from '@romp/data';
import {
  InternalError,
  InvalidStateTransitionError,
  ValidationFailedError,
  parseOrThrow,
} from '@romp/observability';
import storeConfig from '@romp/store-config/generated/store-config.json';

import type { RompApp } from '../app';
import { requireAuthHook } from '../plugins/auth';
import { idempotencyKey, withIdempotency } from '../plugins/idempotency';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireUser } from '../request-context';

/**
 * The order routes.
 *
 * Placement is the one write that both commits money and takes stock, so it is the most guarded
 * route in the platform: a signed-in user, a rate limit, and a required idempotency key so a retry
 * (a flaky network, a double tap) returns the original order rather than reserving stock twice. The
 * request carries only a saved address and the gift/delivery choices; the cart, every price, the
 * totals and the UPI payload are produced server-side inside one transaction. The read route is
 * owner-or-staff — a customer sees their own order, and the random document ID means a guessed
 * order number cannot address one.
 */
export function registerOrderRoutes(app: RompApp): void {
  const { context } = app.deps;
  const orderPrefix = storeConfig.brand.orderPrefix;

  const limit = (request: FastifyRequest): void => {
    app.rateLimiter.consume(rateLimitKey(request, 'placeOrder'), RATE_LIMITS.placeOrder);
  };

  const limitPaymentProof = (request: FastifyRequest): void => {
    app.rateLimiter.consume(rateLimitKey(request, 'paymentProof'), RATE_LIMITS.paymentProof);
  };

  // --- place an order -----------------------------------------------------
  app.post('/v1/orders', { preHandler: requireAuthHook }, async (request, reply) => {
    limit(request);
    const uid = requireUser(request);
    const key = idempotencyKey(request, true);
    const body = parseOrThrow(PlaceOrderRequestSchema, request.body);

    // Live, runtime-editable fees. Absent means the store was never seeded; an order cannot be
    // priced, and quoting stale config fees would charge amounts no longer in force.
    const settings = await getCheckoutSettings(context);
    if (settings === null) {
      throw new InternalError('Checkout is not configured for this store.');
    }

    // The contact snapshot copied onto the order comes from the account, not the request — a
    // customer cannot record someone else's contact against their order.
    const user = await getUser(context, request.caller, uid);

    return withIdempotency(app.idempotencyStore, key, reply, async () => {
      let placed;
      try {
        placed = await reserveAndPlaceOrder(
          context,
          request.caller,
          {
            uid,
            addressId: body.addressId,
            deliverySpeed: body.deliverySpeed,
            isGift: body.isGift,
            giftMessage: body.giftMessage,
            contact: { email: user.email, phone: user.phone },
          },
          settings,
          orderPrefix,
        );
      } catch (error) {
        throw mapPlacementError(error);
      }

      const response: PlaceOrderResponse = {
        orderId: placed.orderId as PlaceOrderResponse['orderId'],
        humanId: placed.humanId as PlaceOrderResponse['humanId'],
        qrPayload: placed.qrPayload,
        amounts: placed.amounts,
        status: placed.status,
      };
      return { statusCode: 201, body: response };
    });
  });

  // --- submit a payment proof ---------------------------------------------
  app.post(
    '/v1/orders/:id/payment-proof',
    { preHandler: requireAuthHook },
    async (request, reply) => {
      limitPaymentProof(request);
      const uid = requireUser(request);
      const key = idempotencyKey(request, true);
      const { id: orderId } = request.params as { id: string };
      const body = parseOrThrow(SubmitPaymentProofRequestSchema, request.body);

      // A proof path must live under this customer's own prefix for this order — the storage rules
      // enforce the same at write time, but validating it here stops a caller recording a foreign
      // path against their order. Reference-only submissions (null) skip the check.
      if (body.screenshotPath !== null && !isOwnProofPath(body.screenshotPath, orderId, uid)) {
        throw new ValidationFailedError([
          { path: 'screenshotPath', message: 'That is not a valid proof path for this order.' },
        ]);
      }

      return withIdempotency(app.idempotencyStore, key, reply, async () => {
        const result = await submitPaymentProof(context, request.caller, {
          orderId,
          upiRef: body.upiRef,
          screenshotPath: body.screenshotPath,
        });
        const response: SubmitPaymentProofResponse = {
          orderId: result.orderId as SubmitPaymentProofResponse['orderId'],
          status: result.status,
          submittedAt: result.submittedAt,
        };
        return { statusCode: 200, body: response };
      });
    },
  );

  // --- read an order ------------------------------------------------------
  app.get('/v1/orders/:id', { preHandler: requireAuthHook }, async (request, reply) => {
    requireUser(request);
    const { id } = request.params as { id: string };

    // `findOrder` filters on ownership: the caller's own order, or any order for staff, else a 404.
    // A foreign order is indistinguishable from a missing one, so a guessed ID reveals nothing.
    const order = await findOrder(context, request.caller, id);

    return reply.send(toOrderView(order));
  });
}

/**
 * Whether a proof path is the caller's own, for this order.
 *
 * The client uploads to `payment-proofs/{orderId}/{uid}/{file}`, a prefix the storage rules already
 * gate to the owner. Re-checking the shape here stops the API recording a path that points at
 * someone else's proof or another order's — the reference the admin will trust must be the one the
 * customer actually uploaded under their own order.
 */
function isOwnProofPath(path: string, orderId: string, uid: string): boolean {
  const prefix = `payment-proofs/${orderId}/${uid}/`;
  return (
    path.startsWith(prefix) &&
    path.length > prefix.length &&
    !path.slice(prefix.length).includes('/')
  );
}

/** Projects a stored order to the customer-facing view. Shared with the admin order routes. */
export function toOrderView(order: WithId<OrderDoc>): OrderView {
  return {
    orderId: order.id as OrderView['orderId'],
    humanId: order.humanId,
    status: order.status,
    fulfilment: order.fulfilment,
    items: order.items,
    amounts: order.amounts,
    shippingAddress: order.shippingAddress,
    deliverySpeed: order.deliverySpeed,
    isGift: order.isGift,
    giftMessage: order.giftMessage,
    payment: order.payment,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Maps a placement error to problem+json.
 *
 * An empty cart or a variant that vanished since it was added is a 409 — the request is well-formed
 * but the state it acts on has moved. `InsufficientStockError` is already an `AppError` (its own
 * 409), and address-not-found is a 404 raised inside the repo, so both pass straight through.
 * Anything else re-throws for the core handler to treat as a 500.
 */
function mapPlacementError(error: unknown): unknown {
  if (error instanceof EmptyCartError) {
    return new InvalidStateTransitionError({ detail: 'Your cart is empty.' });
  }
  if (error instanceof VariantUnavailableError) {
    return new InvalidStateTransitionError({
      detail: 'An item in your cart is no longer available. Please review your cart.',
    });
  }
  return error;
}
