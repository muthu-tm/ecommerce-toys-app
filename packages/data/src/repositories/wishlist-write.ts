import type { WishlistItemDoc } from '@romp/contracts';
import { NotFoundError } from '@romp/observability';

import type { Caller, StoreContext } from '../context';
import { uidOf } from '../context';
import { converters } from '../converters';
import { paths } from '../paths';

import { findProductById } from './catalogue';

/**
 * Wishlist writes — the API-owned half of the wishlist subcollection.
 *
 * Like addresses, the wishlist is client-READ and API-WRITTEN (`firestore.rules`): the heart on a
 * product page reads `users/{uid}/wishlist/{productId}` directly, but the toggle goes through here so
 * the server can check the product exists before saving a reference to it. Keying the document by the
 * product ID makes the toggle idempotent by construction — adding twice is one document, removing is
 * a delete of a known path — so neither operation needs a query or a read-modify-write.
 */

/**
 * Adds a product to the caller's wishlist. Idempotent: adding an already-saved product is a no-op
 * overwrite, not an error.
 *
 * Verifies the product exists and is visible to the caller first (`findProductById` returns null for
 * a missing or draft product), so the wishlist never holds a reference to something that cannot be
 * shown — a 404 rather than a dangling heart.
 */
export async function addToWishlist(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
): Promise<void> {
  const uid = requireUid(caller);

  const product = await findProductById(ctx, caller, productId);
  if (product === null) {
    throw new NotFoundError({ context: { resource: 'product', id: productId } });
  }

  const item: WishlistItemDoc = {
    productId: productId as WishlistItemDoc['productId'],
    addedAt: ctx.clock.now(),
  };
  await ctx.db.doc(paths.wishlistItem(uid, productId)).withConverter(converters.wishlist).set(item);
}

/**
 * Removes a product from the caller's wishlist. Idempotent: removing something not on the list
 * succeeds silently, because the end state — not on the list — is the same either way.
 */
export async function removeFromWishlist(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
): Promise<void> {
  const uid = requireUid(caller);
  await ctx.db.doc(paths.wishlistItem(uid, productId)).delete();
}

/** The caller's uid, or a 404 for anyone not signed in — a wishlist belongs to an account. */
function requireUid(caller: Caller): string {
  const uid = uidOf(caller);
  if (uid === null) {
    throw NotFoundError.forHiddenResource('wishlist', { requiredRole: 'customer' });
  }
  return uid;
}
