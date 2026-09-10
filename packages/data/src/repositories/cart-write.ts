import type { CartDoc, CartItem } from '@romp/contracts';
import { availableStock } from '@romp/contracts';
import { applyCartMutation, mergeCarts } from '@romp/core';
import type { CartMutation, CartMutationRefusal, VariantSnapshot } from '@romp/core';

import { ANONYMOUS } from '../context';
import type { StoreContext } from '../context';
import type { WithId } from '../converter';
import { converters } from '../converters';
import { paths } from '../paths';

import { findProductById } from './catalogue';

/**
 * The cart write path — the customer's own cart, mutated only through here.
 *
 * A cart is written through the API and never by the client, so the price and the quantity are
 * the server's to decide rather than the browser's. Every mutation is a transaction: it reads the
 * cart, resolves the variant and its live availability from a fresh read, applies the pure
 * `@romp/core` logic (which enforces the ceilings and refreshes the price snapshot), and writes the
 * result. The snapshots on a line are for display; the charged amount comes from the checkout quote.
 *
 * These are **not** staff-gated. A cart belongs to whoever holds it: a signed-in customer (keyed by
 * uid) or a guest (keyed by an opaque cookie ID the API holds). The route resolves which and passes
 * a `CartRef`; the repo does not re-derive identity from a caller, because a guest cart has no
 * caller at all. Reads that back the snapshot use the anonymous caller, so only active, public
 * products and variants can enter a cart.
 */

/** How long a guest cart lives before the TTL policy removes it. */
const ANON_CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Which cart to write: a signed-in customer's (by uid) or a guest's (by cookie ID). */
export type CartRef =
  | { readonly kind: 'user'; readonly uid: string }
  | { readonly kind: 'anonymous'; readonly cartId: string };

/** Raised when a mutation is refused by the pure cart logic. Carries the reason for the route to map. */
export class CartMutationError extends Error {
  readonly reason: CartMutationRefusal;
  constructor(reason: CartMutationRefusal) {
    super(`The cart mutation was refused: ${reason}.`);
    this.name = 'CartMutationError';
    this.reason = reason;
  }
}

/** The document ID for a cart ref. */
function cartIdOf(ref: CartRef): string {
  return ref.kind === 'user' ? ref.uid : ref.cartId;
}

/** A fresh, empty cart document for a ref. */
function emptyCart(ref: CartRef, now: Date): CartDoc {
  return ref.kind === 'user'
    ? {
        ownerType: 'user',
        userId: ref.uid as CartDoc['userId'],
        items: [],
        giftWrap: false,
        updatedAt: now,
        expiresAt: null,
      }
    : {
        ownerType: 'anonymous',
        userId: null,
        items: [],
        giftWrap: false,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + ANON_CART_TTL_MS),
      };
}

/**
 * Resolves the display snapshot and live availability for a variant, or null if it cannot enter a
 * cart.
 *
 * Reads as the anonymous caller, so a draft or archived product — or an inactive variant — resolves
 * to null and is refused, the same visibility a customer has. Availability is read straight from the
 * inventory document (the server legitimately needs the count the customer-facing API hides). The
 * cover image is the product's first media item, if any.
 */
async function resolveVariant(
  ctx: StoreContext,
  productId: string,
  variantId: string,
): Promise<{ readonly snapshot: VariantSnapshot; readonly available: number } | null> {
  const product = await findProductById(ctx, ANONYMOUS, productId);
  if (product === null) return null;

  const variantSnap = await ctx.db
    .doc(paths.variant(productId, variantId))
    .withConverter(converters.variants)
    .get();
  const variant = variantSnap.data();
  if (!variant?.active) return null;

  const inventorySnap = await ctx.db
    .doc(paths.inventory(variantId))
    .withConverter(converters.inventory)
    .get();
  const inventory = inventorySnap.data();
  const available =
    inventory === undefined ? 0 : availableStock(inventory.onHandTotal, inventory.reserved);

  const snapshot: VariantSnapshot = {
    variantId,
    productId,
    sku: variant.sku,
    priceMinor: variant.priceMinor,
    nameSnapshot: product.name,
    variantNameSnapshot: variant.name,
    imagePathSnapshot: product.media[0]?.path ?? null,
  };

  return { snapshot, available };
}

/** Reads a cart document by ref, or null when none exists yet. */
export async function readCart(ctx: StoreContext, ref: CartRef): Promise<WithId<CartDoc> | null> {
  const snapshot = await ctx.db
    .doc(paths.cart(cartIdOf(ref)))
    .withConverter(converters.carts)
    .get();
  const data = snapshot.data();
  return data === undefined ? null : { ...data, id: snapshot.id };
}

/**
 * Adds a variant to the cart, or sets its quantity.
 *
 * A transaction: read the cart (create an empty one in memory if absent), resolve the variant and
 * its availability, apply the pure mutation, write the cart. `mode` is `add` (increment the line)
 * or `set` (replace the quantity). A refusal — variant gone, over stock, over the per-line ceiling —
 * throws a `CartMutationError` having written nothing. The `maxQtyPerLine` ceiling is supplied by
 * the route from store config.
 */
export async function addOrUpdateCartItem(
  ctx: StoreContext,
  ref: CartRef,
  input: {
    readonly productId: string;
    readonly variantId: string;
    readonly qty: number;
    readonly mode: 'add' | 'set';
    readonly maxQtyPerLine: number;
  },
): Promise<WithId<CartDoc>> {
  const cartRef = ctx.db.doc(paths.cart(cartIdOf(ref))).withConverter(converters.carts);
  const now = ctx.clock.now();

  const resolved = await resolveVariant(ctx, input.productId, input.variantId);
  if (resolved === null) throw new CartMutationError('variant_unavailable');

  const next = await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(cartRef);
    const current = snapshot.data() ?? emptyCart(ref, now);

    const mutation: CartMutation = {
      kind: input.mode,
      variantId: input.variantId,
      qty: input.qty,
    };
    const applied = applyCartMutation(current.items, mutation, {
      variant: resolved.snapshot,
      available: resolved.available,
      maxQtyPerLine: input.maxQtyPerLine,
      now,
    });
    if (!applied.ok) throw new CartMutationError(applied.reason);

    const nextCart: CartDoc = { ...current, items: [...applied.items], updatedAt: now };
    tx.set(cartRef, nextCart);
    return nextCart;
  });

  return { ...next, id: cartIdOf(ref) };
}

/**
 * Removes a variant's line from the cart.
 *
 * No variant read: removing a line needs nothing about the variant, and a line for a since-deleted
 * variant must still be removable. A remove on an absent cart or line is a no-op that returns the
 * (possibly empty) cart, so a double-click does not error.
 */
export async function removeCartItem(
  ctx: StoreContext,
  ref: CartRef,
  variantId: string,
): Promise<WithId<CartDoc>> {
  const cartRef = ctx.db.doc(paths.cart(cartIdOf(ref))).withConverter(converters.carts);
  const now = ctx.clock.now();

  const next = await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(cartRef);
    const current = snapshot.data() ?? emptyCart(ref, now);

    // A remove never refuses, so it drops the line unconditionally rather than routing through
    // the mutation result's ok/refusal branch — the availability context a remove does not use.
    const items = current.items.filter((item) => item.variantId !== variantId);

    const nextCart: CartDoc = { ...current, items, updatedAt: now };
    tx.set(cartRef, nextCart);
    return nextCart;
  });

  return { ...next, id: cartIdOf(ref) };
}

/** Toggles the gift-wrap flag on the cart. */
export async function setGiftWrap(
  ctx: StoreContext,
  ref: CartRef,
  giftWrap: boolean,
): Promise<WithId<CartDoc>> {
  const cartRef = ctx.db.doc(paths.cart(cartIdOf(ref))).withConverter(converters.carts);
  const now = ctx.clock.now();

  const next = await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(cartRef);
    const current = snapshot.data() ?? emptyCart(ref, now);
    const nextCart: CartDoc = { ...current, giftWrap, updatedAt: now };
    tx.set(cartRef, nextCart);
    return nextCart;
  });

  return { ...next, id: cartIdOf(ref) };
}

/**
 * Merges a guest's cart into the signed-in customer's, then deletes the guest cart.
 *
 * On sign-in the two carts are folded with `@romp/core`'s `mergeCarts`: shared variants sum,
 * everything is capped at the lower of live availability and the per-line ceiling, and a line no
 * checkout could fulfil is dropped. Availability is resolved for the union of variants once, before
 * the transaction, then the transaction re-reads both carts and writes the merged user cart and
 * removes the anonymous one atomically. A merge with no anonymous cart is a no-op returning the user
 * cart.
 */
export async function mergeAnonymousCart(
  ctx: StoreContext,
  uid: string,
  anonCartId: string,
  maxQtyPerLine: number,
): Promise<WithId<CartDoc>> {
  const userRef = ctx.db.doc(paths.cart(uid)).withConverter(converters.carts);
  const anonRef = ctx.db.doc(paths.cart(anonCartId)).withConverter(converters.carts);
  const now = ctx.clock.now();

  // Resolve availability for every variant either cart might contribute, outside the transaction —
  // reads of many inventory docs do not belong inside the read-modify-write of two cart docs.
  const [userSnap, anonSnap] = await Promise.all([userRef.get(), anonRef.get()]);
  const userCart = userSnap.data();
  const anonCart = anonSnap.data();

  if (anonCart === undefined || anonCart.items.length === 0) {
    // Nothing to merge; return the user cart (empty if none).
    const existing = userCart ?? emptyCart({ kind: 'user', uid }, now);
    return { ...existing, id: uid };
  }

  const variantIds = [
    ...new Set([...(userCart?.items ?? []), ...anonCart.items].map((item) => item.variantId)),
  ];
  const availableByVariant = new Map<string, number>();
  await Promise.all(
    variantIds.map(async (variantId) => {
      const inventorySnap = await ctx.db
        .doc(paths.inventory(variantId))
        .withConverter(converters.inventory)
        .get();
      const inventory = inventorySnap.data();
      availableByVariant.set(
        variantId,
        inventory === undefined ? 0 : availableStock(inventory.onHandTotal, inventory.reserved),
      );
    }),
  );

  const next = await ctx.db.runTransaction(async (tx) => {
    const [freshUser, freshAnon] = await Promise.all([tx.get(userRef), tx.get(anonRef)]);
    const base = freshUser.data() ?? emptyCart({ kind: 'user', uid }, now);
    const anonItems = freshAnon.data()?.items ?? [];

    const mergedItems = mergeCarts(base.items, anonItems, availableByVariant, maxQtyPerLine);
    const merged: CartDoc = {
      ...base,
      items: [...mergedItems],
      giftWrap: base.giftWrap || (freshAnon.data()?.giftWrap ?? false),
      updatedAt: now,
    };

    tx.set(userRef, merged);
    tx.delete(anonRef);
    return merged;
  });

  return { ...next, id: uid };
}

/** Re-exports the line type for callers assembling a cart view. */
export type { CartItem };
