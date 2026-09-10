import type { FastifyReply, FastifyRequest } from 'fastify';

import type { CartDoc, CartView } from '@romp/contracts';
import { AddCartItemRequestSchema, UpdateCartRequestSchema, multiplyMoney } from '@romp/contracts';
import { cartItemCount, cartSubtotal } from '@romp/core';
import {
  ANONYMOUS,
  CartMutationError,
  addOrUpdateCartItem,
  getAvailability,
  mergeAnonymousCart,
  readCart,
  removeCartItem,
  setGiftWrap,
} from '@romp/data';
import type { CartRef, WithId } from '@romp/data';
import {
  InvalidStateTransitionError,
  ValidationFailedError,
  parseOrThrow,
} from '@romp/observability';
import storeConfig from '@romp/store-config/generated/store-config.json';

import type { RompApp } from '../app';
import {
  cartCookieHeader,
  clearedCartCookieHeader,
  newCartId,
  readCartCookie,
  verifyCartCookie,
} from '../cart/cookie';
import { requireAuthHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireUser } from '../request-context';

/**
 * The cart routes — the only way a cart is written.
 *
 * A cart belongs to whoever holds it: a signed-in customer (keyed by uid) or a guest (keyed by an
 * opaque cart ID in a signed cookie). These routes resolve which — a verified token wins, else the
 * cookie, else a fresh guest cart whose cookie is planted on the response — and hand a `CartRef` to
 * the write repo. They take no auth hook (a guest may shop), except `merge`, which needs a signed-in
 * user to fold a guest cart into. Every response is a `CartView`: the lines with a refreshed
 * `inStock` and a recomputed subtotal, which is display-only — the charged amount is the checkout
 * quote's.
 */
export function registerCartRoutes(app: RompApp): void {
  const { context } = app.deps;
  const maxQtyPerLine = storeConfig.commerce.maxQtyPerLine;
  const secret = app.deps.config.cartCookieSecret;

  const limit = (request: FastifyRequest): void => {
    app.rateLimiter.consume(rateLimitKey(request, 'cartWrite'), RATE_LIMITS.cartWrite);
  };

  /**
   * Resolves the cart to act on, and whether a cookie must be set.
   *
   * A signed-in caller uses their uid cart and no cookie changes. A guest uses the cart ID from a
   * valid signed cookie, or a freshly minted one — in which case `setCookie` carries the ID the
   * response must plant so the next request finds the same cart.
   */
  const resolveCart = (
    request: FastifyRequest,
  ): { readonly ref: CartRef; readonly setCookie: string | null } => {
    if (request.caller.kind === 'customer' || request.caller.kind === 'operator') {
      return { ref: { kind: 'user', uid: request.caller.uid }, setCookie: null };
    }
    const existing = verifyCartCookie(readCartCookie(request.headers.cookie), secret);
    if (existing !== null) {
      return { ref: { kind: 'anonymous', cartId: existing }, setCookie: null };
    }
    const cartId = newCartId();
    return { ref: { kind: 'anonymous', cartId }, setCookie: cartId };
  };

  /** Plants the guest cart cookie on the response when a fresh one was minted. */
  const plantCookie = (reply: FastifyReply, setCookie: string | null): void => {
    if (setCookie !== null) reply.header('set-cookie', cartCookieHeader(setCookie, secret));
  };

  /** Builds the customer-facing view of a cart, refreshing `inStock` from live availability. */
  const toView = async (cart: CartDoc | null): Promise<CartView> => {
    if (cart === null || cart.items.length === 0) {
      return {
        items: [],
        giftWrap: cart?.giftWrap ?? false,
        itemCount: 0,
        subtotalMinor: cartSubtotal([]),
      };
    }

    const availability = await getAvailability(
      context,
      ANONYMOUS,
      cart.items.map((item) => item.variantId),
    );
    const inStockByVariant = new Map(availability.map((a) => [a.variantId, a.inStock]));

    return {
      items: cart.items.map((item) => ({
        variantId: item.variantId,
        productId: item.productId,
        sku: item.sku,
        qty: item.qty,
        priceMinorSnapshot: item.priceMinorSnapshot,
        nameSnapshot: item.nameSnapshot,
        variantNameSnapshot: item.variantNameSnapshot,
        imagePathSnapshot: item.imagePathSnapshot,
        lineSubtotalMinor: multiplyMoney(item.priceMinorSnapshot, item.qty),
        inStock: inStockByVariant.get(item.variantId) ?? false,
      })),
      giftWrap: cart.giftWrap,
      itemCount: cartItemCount(cart.items),
      subtotalMinor: cartSubtotal(cart.items),
    };
  };

  const sendView = async (
    reply: FastifyReply,
    cart: WithId<CartDoc> | null,
    setCookie: string | null,
  ): Promise<void> => {
    plantCookie(reply, setCookie);
    const view = await toView(cart);
    await reply.send(view);
  };

  // --- read ---------------------------------------------------------------
  app.get('/v1/cart', async (request, reply) => {
    const { ref, setCookie } = resolveCart(request);
    const cart = await readCart(context, ref);
    await sendView(reply, cart, setCookie);
  });

  // --- add / set a line ---------------------------------------------------
  app.post('/v1/cart/items', async (request, reply) => {
    limit(request);
    const body = parseOrThrow(AddCartItemRequestSchema, request.body);
    const { ref, setCookie } = resolveCart(request);

    let cart;
    try {
      cart = await addOrUpdateCartItem(context, ref, {
        productId: body.productId,
        variantId: body.variantId,
        qty: body.qty,
        mode: body.mode,
        maxQtyPerLine,
      });
    } catch (error) {
      throw mapCartError(error);
    }

    plantCookie(reply, setCookie);
    const view = await toView(cart);
    return reply.code(200).send(view);
  });

  // --- remove a line ------------------------------------------------------
  app.delete('/v1/cart/items/:variantId', async (request, reply) => {
    limit(request);
    const { variantId } = request.params as { variantId: string };
    const { ref, setCookie } = resolveCart(request);

    const cart = await removeCartItem(context, ref, variantId);
    plantCookie(reply, setCookie);
    const view = await toView(cart);
    return reply.code(200).send(view);
  });

  // --- gift wrap ----------------------------------------------------------
  app.patch('/v1/cart', async (request, reply) => {
    limit(request);
    const body = parseOrThrow(UpdateCartRequestSchema, request.body);
    const { ref, setCookie } = resolveCart(request);

    const cart = await setGiftWrap(context, ref, body.giftWrap);
    plantCookie(reply, setCookie);
    const view = await toView(cart);
    return reply.code(200).send(view);
  });

  // --- merge guest cart on sign-in ----------------------------------------
  app.post('/v1/cart/merge', { preHandler: requireAuthHook }, async (request, reply) => {
    limit(request);
    const uid = requireUser(request);

    // The guest cart to fold in is the one the cookie points at. No cookie means nothing to
    // merge — the response is simply the user's current cart.
    const anonCartId = verifyCartCookie(readCartCookie(request.headers.cookie), secret);
    if (anonCartId === null) {
      const cart = await readCart(context, { kind: 'user', uid });
      const view = await toView(cart);
      return reply.code(200).send(view);
    }

    const merged = await mergeAnonymousCart(context, uid, anonCartId, maxQtyPerLine);
    // Clear the guest cookie: the guest cart is gone, folded into the account's.
    reply.header('set-cookie', clearedCartCookieHeader());
    const view = await toView(merged);
    return reply.code(200).send(view);
  });
}

/**
 * Maps a cart write error to problem+json.
 *
 * A refusal from the pure cart logic is a 409 (over stock, over the per-line ceiling) or a
 * validation-shaped 422 (the variant is not something that can be added), with a message the
 * storefront shows. Anything else re-throws for the core handler to treat as a 500.
 */
function mapCartError(error: unknown): Error {
  if (error instanceof CartMutationError) {
    if (error.reason === 'variant_unavailable') {
      return new ValidationFailedError([
        { path: 'variantId', message: 'This item is no longer available.' },
      ]);
    }
    return new InvalidStateTransitionError({
      detail:
        error.reason === 'qty_exceeds_available'
          ? 'There is not enough stock for that quantity.'
          : 'That is more than the maximum quantity per item.',
    });
  }
  return error instanceof Error ? error : new Error(String(error));
}
