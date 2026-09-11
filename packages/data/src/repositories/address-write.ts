import type { AddressDoc, EventDoc, PostalAddress } from '@romp/contracts';
import { NotFoundError, ValidationFailedError } from '@romp/observability';

import type { Caller, StoreContext } from '../context';
import { actorIdOf, requireOwnership, uidOf } from '../context';
import type { WithId } from '../converter';
import { converters } from '../converters';
import { paths } from '../paths';

import { appendEventInTransaction } from './events';

/**
 * Address writes — the API-owned half of the addresses subcollection.
 *
 * Addresses are client-READ and API-WRITTEN (`firestore.rules`): a customer reads their own
 * `users/{uid}/addresses` directly under the rules, but every write goes through here, because two
 * invariants can only be held server-side. First, **exactly one default**: promoting one address to
 * default must demote the others, which is a multi-document write that a client cannot make
 * atomically and rules cannot enforce across documents. Second, **there is always a default while any
 * address exists**: the first address is the default whether or not the customer asked, and the
 * default cannot be deleted out from under the invariant — you promote another first.
 *
 * A create appends an `account.address_added` event to the spine in the same transaction, so the
 * customer's own feed shows a new delivery address the moment it lands — the takeover-visible
 * property `IDENTITY.md` asks for: an attacker adding a drop address is a change the real owner sees.
 */

/** The fields a customer supplies for a new or edited address. */
export interface AddressInput extends PostalAddress {
  readonly label: string;
  readonly isDefault: boolean;
}

/**
 * Creates an address for the caller.
 *
 * In one transaction: reads the existing addresses, decides the default (the requested value, or
 * forced true when this is the first address so the invariant holds), demotes the others if this one
 * becomes default, writes the new address, and appends the `account.address_added` event. Returns the
 * new address's ID.
 */
export async function createAddress(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
  input: AddressInput,
): Promise<{ readonly id: string }> {
  assertOwnAccount(caller, uid);
  const now = ctx.clock.now();
  const actorId = actorIdOf(caller);

  const collection = ctx.db.collection(paths.addresses(uid)).withConverter(converters.addresses);
  const newRef = collection.doc();

  return ctx.db.runTransaction(async (tx) => {
    const existing = await tx.get(collection);
    const isFirst = existing.empty;
    // The first address is always the default; otherwise honour the request.
    const makeDefault = isFirst || input.isDefault;

    if (makeDefault) {
      // Demote every current default so exactly one remains after this write.
      for (const doc of existing.docs) {
        if (doc.data().isDefault) tx.update(doc.ref, { isDefault: false, updatedAt: now });
      }
    }

    const address: AddressDoc = {
      label: input.label,
      recipientName: input.recipientName,
      line1: input.line1,
      line2: input.line2,
      city: input.city,
      state: input.state,
      pincode: input.pincode,
      phone: input.phone,
      isDefault: makeDefault,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(newRef, address);

    const event: EventDoc = {
      type: 'account.address_added',
      actorId: actorId as EventDoc['actorId'],
      subject: { kind: 'account', id: uid },
      payload: { type: 'account.address_added', userId: uid as never, addressLabel: input.label },
      at: now,
    };
    appendEventInTransaction(tx, ctx, event);

    return { id: newRef.id };
  });
}

/** A partial edit of an address. Any omitted field is left unchanged. */
export interface AddressPatch {
  readonly label?: string;
  readonly recipientName?: string;
  readonly line1?: string;
  readonly line2?: string | null;
  readonly city?: string;
  readonly state?: string;
  readonly pincode?: string;
  readonly phone?: string;
  /** Promoting to default demotes the others. Passing `false` is ignored — the default is changed by promoting another, never by leaving none. */
  readonly isDefault?: boolean;
}

/**
 * Updates an address.
 *
 * Edits the supplied fields, and — if the patch promotes this address to default — demotes every
 * other in the same transaction, so exactly one default survives. Demotion via `isDefault: false` is
 * deliberately a no-op: an address stops being the default only when another is promoted, never by a
 * request that would leave the customer with no default at all.
 */
export async function updateAddress(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
  addressId: string,
  patch: AddressPatch,
): Promise<void> {
  assertOwnAccount(caller, uid);
  const now = ctx.clock.now();

  const collection = ctx.db.collection(paths.addresses(uid)).withConverter(converters.addresses);
  const targetRef = ctx.db.doc(paths.address(uid, addressId)).withConverter(converters.addresses);

  await ctx.db.runTransaction(async (tx) => {
    const current = (await tx.get(targetRef)).data();
    if (current === undefined) {
      throw new NotFoundError({ context: { resource: 'address', id: addressId } });
    }

    const promoting = patch.isDefault === true && !current.isDefault;
    if (promoting) {
      const existing = await tx.get(collection);
      for (const doc of existing.docs) {
        if (doc.id !== addressId && doc.data().isDefault) {
          tx.update(doc.ref, { isDefault: false, updatedAt: now });
        }
      }
    }

    const next: AddressDoc = {
      ...current,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.recipientName !== undefined ? { recipientName: patch.recipientName } : {}),
      ...(patch.line1 !== undefined ? { line1: patch.line1 } : {}),
      ...(patch.line2 !== undefined ? { line2: patch.line2 } : {}),
      ...(patch.city !== undefined ? { city: patch.city } : {}),
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.pincode !== undefined ? { pincode: patch.pincode } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      // Promotion sets it true; a `false` request never removes the last default.
      isDefault: promoting ? true : current.isDefault,
      updatedAt: now,
    };
    tx.set(targetRef, next);
  });
}

/**
 * Deletes an address.
 *
 * Refuses to delete the default while other addresses exist — the customer must promote another
 * first, or the "always exactly one default" invariant would break — and refuses to delete the only
 * address, which is the default by construction. A well-formed request the state forbids is a 400
 * naming the constraint, not a silent success.
 */
export async function deleteAddress(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
  addressId: string,
): Promise<void> {
  assertOwnAccount(caller, uid);

  const collection = ctx.db.collection(paths.addresses(uid)).withConverter(converters.addresses);
  const targetRef = ctx.db.doc(paths.address(uid, addressId)).withConverter(converters.addresses);

  await ctx.db.runTransaction(async (tx) => {
    const current = (await tx.get(targetRef)).data();
    if (current === undefined) {
      throw new NotFoundError({ context: { resource: 'address', id: addressId } });
    }

    if (current.isDefault) {
      const existing = await tx.get(collection);
      if (existing.size > 1) {
        throw new ValidationFailedError(
          [
            {
              path: 'addressId',
              message: 'Make another address the default before deleting this one.',
            },
          ],
          { detail: 'This is your default address. Set a different default first.' },
        );
      }
    }

    tx.delete(targetRef);
  });
}

/**
 * Guards a write to an account subcollection: only the account's owner may write it.
 *
 * A customer writes their own addresses; nobody writes another's (support edits are out of scope for
 * v1.0). `requireOwnership` needs a document; for a path-owned collection the uid in the path is the
 * owner, so the check is a direct comparison, refused as a 404 for non-disclosure like every other
 * account guard.
 */
function assertOwnAccount(caller: Caller, uid: string): void {
  if (uidOf(caller) === uid) return;
  // Reuse the ownership 404 shape without a document, by handing it a null resource.
  requireOwnership<WithId<AddressDoc>>(caller, null, () => uid, { resource: 'address', id: uid });
}
