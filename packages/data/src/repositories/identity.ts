import type { IdentityIndexDoc, UserDoc } from '@romp/contracts';
import { IdentifierTakenError } from '@romp/observability';

import type { StoreContext } from '../context';
import { converters } from '../converters';
import { isAlreadyExists } from '../firestore-errors';
import { paths } from '../paths';

/**
 * Identity writes — the registration transaction and its rollback.
 *
 * These are not user-scoped reads, so they do not take a `Caller`: registration happens
 * *before* an account exists, and the API has already authenticated that the request may
 * attempt it (it is a public, rate-limited endpoint). What they enforce instead is the
 * uniqueness invariant that a schema cannot: an identifier belongs to exactly one uid.
 *
 * `identityIndex` is server-only (rules deny it to every client), because it maps
 * identifier → uid and a readable version is a bulk account-enumeration oracle. It is
 * written here, through the Admin SDK, and nowhere else.
 */

/**
 * Reserves an identifier for a uid with a create-only write.
 *
 * The whole point is atomicity against a concurrent duplicate: two registrations for the
 * same number that both check "is it taken?" and then both write would each believe they
 * own it. A `create` (via a transaction that reads-then-creates only if absent) makes the
 * second one fail, and it fails as `IdentifierTakenError` — the 409 the API returns
 * without echoing the identifier, so registration is not an enumeration oracle.
 *
 * Called *before* the Auth user is created is wrong; called *after* leaves an orphan Auth
 * user if it conflicts. The API creates the Auth user first (it needs the uid), then
 * reserves here, and deletes the Auth user if this throws — see the route. This function
 * owns only the atomic reservation.
 */
export async function reserveIdentity(
  ctx: StoreContext,
  normalizedIdentifier: string,
  entry: IdentityIndexDoc,
): Promise<void> {
  const ref = ctx.db
    .doc(paths.identityIndexEntry(normalizedIdentifier))
    .withConverter(converters.identityIndex);

  // `create` fails if the document already exists, atomically and without a read — which is
  // exactly the reservation semantics. A transaction that reads-then-throws would have the
  // throw retried by the SDK (it cannot tell a deliberate abort from contention) and surface
  // as an opaque error; `create` gives a precise ALREADY_EXISTS instead.
  try {
    await ref.create(entry);
  } catch (error) {
    if (isAlreadyExists(error)) {
      // Already owned — by this uid on a retry, or by someone else. Either way the caller
      // may not claim it now; the API maps this to a 409 that does not disclose which.
      throw new IdentifierTakenError();
    }
    throw error;
  }
}

/**
 * Releases a reservation. Used to roll back when a later registration step fails.
 *
 * Idempotent: deleting an absent document is a no-op, so a rollback that runs after a
 * partial failure cannot itself fail for "already gone".
 */
export async function releaseIdentity(
  ctx: StoreContext,
  normalizedIdentifier: string,
): Promise<void> {
  await ctx.db.doc(paths.identityIndexEntry(normalizedIdentifier)).delete();
}

/**
 * Whether an identifier is already reserved.
 *
 * For the `check-identifier` availability endpoint. Returns a boolean and nothing else —
 * never the uid — because the endpoint is public and must not become an oracle that maps
 * an identifier to an account. The rate limit on that route is the other half of not being
 * an enumeration surface.
 */
export async function isIdentifierTaken(
  ctx: StoreContext,
  normalizedIdentifier: string,
): Promise<boolean> {
  const snapshot = await ctx.db.doc(paths.identityIndexEntry(normalizedIdentifier)).get();
  return snapshot.exists;
}

/**
 * Writes the `users/{uid}` profile.
 *
 * Separate from the reservation because the uid comes from Auth, which is not Firestore:
 * the three systems (identityIndex, Auth, users) cannot share one transaction, so the API
 * orders them and compensates on failure. The converter validates the document on write,
 * so an invalid profile fails here rather than being read back wrong later.
 */
export async function createUserProfile(
  ctx: StoreContext,
  uid: string,
  profile: UserDoc,
): Promise<void> {
  await ctx.db.doc(paths.user(uid)).withConverter(converters.users).set(profile);
}

/**
 * Updates mutable profile fields on `users/{uid}`.
 *
 * A partial update of the customer-editable fields only — the display name in v1.0. The
 * `updatedAt` stamp is set from the caller's clock so a fixed-clock test is deterministic.
 * Identifier fields are not updatable here: changing a login credential is a recovery flow,
 * not a profile edit.
 */
export async function updateUserProfile(
  ctx: StoreContext,
  uid: string,
  patch: { readonly displayName: string },
): Promise<void> {
  await ctx.db
    .doc(paths.user(uid))
    .update({ displayName: patch.displayName, updatedAt: ctx.clock.now() });
}
