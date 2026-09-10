import type { AddressDoc, CartDoc, UserDoc, WishlistItemDoc } from '@romp/contracts';

import type { Caller, StoreContext } from '../context';
import { requireOwnership, requireStaff, uidOf } from '../context';
import type { WithId } from '../converter';
import { converters } from '../converters';
import { paths } from '../paths';

import { getDocument, runQuery } from './read';

/**
 * Account reads.
 *
 * Every function here takes the caller and filters on it. Not as defence in depth — as
 * **the** defence. These reads go through the Admin SDK, which does not consult
 * `infra/firestore.rules`, so nothing else stands between a wrong `uid` and another
 * customer's addresses.
 *
 * The pattern is the same throughout: read the document, then hand it to
 * `requireOwnership`, which returns it or throws a **404**. Never 403 — a 403 confirms
 * the resource exists, which discloses that an account or an order is real
 * (`SECURITY.md` § 2).
 *
 * The ownership check is not separable from the read. `requireOwnership` returns the
 * document, so the only way to obtain it is to pass the check; a boolean helper would
 * be easy to call and forget to branch on.
 */

/**
 * A user record, if the caller may see it.
 *
 * Throws `NotFoundError` rather than returning null for a foreign uid, because the two
 * cases must be indistinguishable from outside.
 */
export async function getUser(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
): Promise<WithId<UserDoc>> {
  const user = await getDocument(ctx, paths.user(uid), converters.users);

  // The document ID *is* the owner here, so ownership is the path rather than a field.
  return requireOwnership(caller, user, () => uid, { resource: 'user', id: uid });
}

/**
 * The signed-in caller's own record.
 *
 * Returns null for an anonymous caller rather than throwing: "nobody is signed in" is a
 * normal state for a page that renders differently when they are, not an error.
 */
export async function getOwnUser(
  ctx: StoreContext,
  caller: Caller,
): Promise<WithId<UserDoc> | null> {
  const uid = uidOf(caller);
  if (uid === null) return null;

  return getDocument(ctx, paths.user(uid), converters.users);
}

/**
 * A customer's saved addresses.
 *
 * Default first, then newest, so the checkout form's preselection is the first element
 * and does not need a second pass to find.
 */
export async function listAddresses(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
): Promise<readonly WithId<AddressDoc>[]> {
  assertMayReadAccount(caller, uid, 'addresses');

  return runQuery(
    ctx.db
      .collection(paths.addresses(uid))
      .withConverter(converters.addresses)
      .orderBy('isDefault', 'desc')
      .orderBy('createdAt', 'desc'),
  );
}

export async function findAddress(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
  addressId: string,
): Promise<WithId<AddressDoc>> {
  assertMayReadAccount(caller, uid, 'address');
  const address = await getDocument(ctx, paths.address(uid, addressId), converters.addresses);

  return requireOwnership(caller, address, () => uid, { resource: 'address', id: addressId });
}

/**
 * The default address, or null.
 *
 * Derived from the list rather than queried on `isDefault == true`, because the
 * "exactly one default" invariant is maintained by the API transaction and a query that
 * trusted it would return an arbitrary one of two if that invariant were ever broken.
 * Taking the first of an ordered list at least does so deterministically.
 */
export async function findDefaultAddress(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
): Promise<WithId<AddressDoc> | null> {
  const addresses = await listAddresses(ctx, caller, uid);

  return addresses.find((address) => address.isDefault) ?? null;
}

/** A customer's wishlist, newest first. */
export async function listWishlist(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
): Promise<readonly WithId<WishlistItemDoc>[]> {
  assertMayReadAccount(caller, uid, 'wishlist');

  return runQuery(
    ctx.db
      .collection(paths.wishlist(uid))
      .withConverter(converters.wishlist)
      .orderBy('addedAt', 'desc'),
  );
}

/**
 * Whether a product is on the caller's wishlist.
 *
 * A point read, because the wishlist is keyed by product ID. On a product page this is
 * one document rather than a query, and it returns false for an anonymous caller without
 * touching Firestore at all.
 */
export async function isWishlisted(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
): Promise<boolean> {
  const uid = uidOf(caller);
  if (uid === null) return false;

  const item = await getDocument(ctx, paths.wishlistItem(uid, productId), converters.wishlist);

  return item !== null;
}

/**
 * A cart by ID.
 *
 * Ownership is checked against the stored `userId`, **not** against the document ID.
 * They coincide for a signed-in customer, and relying on that would make the check a
 * naming convention rather than a check — a cart at `carts/{someone-elses-uid}` with a
 * different `userId` inside would pass.
 *
 * An anonymous cart has `userId: null`, so `requireOwnership` refuses it for every
 * caller except staff. That is correct: an anonymous cart is reached by cookie through
 * the API, which looks it up by ID without going through this function.
 */
export async function findCart(
  ctx: StoreContext,
  caller: Caller,
  cartId: string,
): Promise<WithId<CartDoc>> {
  const cart = await getDocument(ctx, paths.cart(cartId), converters.carts);

  return requireOwnership(caller, cart, (candidate) => candidate.userId, {
    resource: 'cart',
    id: cartId,
  });
}

/**
 * The signed-in caller's own cart, or null.
 *
 * Null rather than an empty cart: "no cart yet" and "a cart with nothing in it" are
 * different states, and only the second should show a "your cart is empty" message with
 * a saved-items rail beneath it.
 */
export async function findOwnCart(
  ctx: StoreContext,
  caller: Caller,
): Promise<WithId<CartDoc> | null> {
  const uid = uidOf(caller);
  if (uid === null) return null;

  return getDocument(ctx, paths.cart(uid), converters.carts);
}

/**
 * Guards a subcollection read where the owner is in the path, not in a document.
 *
 * `requireOwnership` needs a document to check. For a *collection* read under
 * `users/{uid}/…` there is no single document, and the uid in the path is the owner — so
 * the check happens before the query rather than after it, and a foreign uid never
 * reaches Firestore.
 */
function assertMayReadAccount(caller: Caller, uid: string, resource: string): void {
  const callerUid = uidOf(caller);
  if (callerUid === uid) return;

  // Falls through to the staff check, which throws a 404 for everyone else — including
  // an anonymous caller, for whom `callerUid` is null and can never match.
  requireStaff(caller, { resource });
}
