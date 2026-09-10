import { z } from 'zod';

import { E164PhoneSchema, EmailSchema, IdentifierTypeSchema } from '../primitives/identifiers';
import { ProductIdSchema, UidSchema } from '../primitives/ids';
import { InstantSchema, NullableInstantSchema } from '../primitives/instant';
import { MoneySchema } from '../primitives/money';

import { AuditTimestampsSchema, PostalAddressSchema } from './common';

/**
 * `users/{uid}` — document ID is the Firebase Auth uid.
 *
 * Deliberately **not** stored: the customer tier (Gold/Silver/New). It is derived
 * at read time from `orderCount` and `lifetimeValueMinor`, because a stored tier
 * drifts the moment the thresholds change and then has to be backfilled across
 * every account.
 *
 * `phone` is **PII of the sharpest kind** — for a mobile-only account it is the
 * login credential (ADR-0006), so exposing one enables a targeted credential
 * attack against an account the attacker now knows exists. The logger redacts it
 * at serialisation time so a careless `logger.info({ user })` cannot leak it.
 */
export const UserDocSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    /** Which identifier is the login credential. The other may be absent entirely. */
    primaryIdentifierType: IdentifierTypeSchema,
    /** Real email. Null for mobile-only accounts — the Auth alias is not an email. */
    email: EmailSchema.nullable(),
    /** E.164. **PII**, never logged, masked in admin by default. */
    phone: E164PhoneSchema.nullable(),

    /** Denormalised. Owner: the payment-verified transaction. */
    orderCount: z.int().nonnegative(),
    /** Denormalised, net of refunds. Owner: the payment-verified and refund transactions. */
    lifetimeValueMinor: MoneySchema,
    lastOrderAt: NullableInstantSchema,

    ...AuditTimestampsSchema.shape,

    /**
     * Set by a deletion request. The document is redacted rather than removed,
     * because orders reference it and statutory retention outlives the account.
     */
    deletedAt: NullableInstantSchema,
    deletionReason: z.string().min(1).max(500).nullable(),
  })
  .refine(
    (user) => (user.primaryIdentifierType === 'email' ? user.email !== null : user.phone !== null),
    {
      // An account whose primary identifier is missing cannot be logged into and
      // cannot be recovered. Catching it here makes it a validation failure rather
      // than a support ticket.
      error: 'The primary identifier must be present on the account.',
      path: ['primaryIdentifierType'],
    },
  )
  .refine((user) => user.orderCount > 0 || user.lifetimeValueMinor === 0, {
    error: 'An account with no orders has no lifetime value.',
    path: ['lifetimeValueMinor'],
  })
  .refine((user) => (user.deletionReason === null) === (user.deletedAt === null), {
    error: 'A deletion records both when and why.',
    path: ['deletionReason'],
  });
export type UserDoc = z.infer<typeof UserDocSchema>;

/**
 * `identityIndex/{normalizedIdentifier}` — document ID is the normalised
 * identifier: a lowercased email or an E.164 phone number.
 *
 * **Server-only, in rules and forever.** It maps identifier → uid, which makes it
 * a bulk account-enumeration oracle: readable, it answers "does this phone number
 * have an account here" for every number in a list. Since a phone number is also a
 * login credential, that is the first half of a credential attack.
 *
 * Created inside the same transaction as the Auth user, `create`-only, so a
 * duplicate registration fails atomically rather than producing two accounts that
 * both think they own the identifier.
 */
export const IdentityIndexDocSchema = z.object({
  uid: UidSchema,
  type: IdentifierTypeSchema,
  createdAt: InstantSchema,
});
export type IdentityIndexDoc = z.infer<typeof IdentityIndexDocSchema>;

/**
 * `users/{uid}/addresses/{addressId}`.
 *
 * **Invariant** — exactly one `isDefault: true` per user once any address exists,
 * and the last remaining address cannot be deleted while it is the default. Both
 * are enforced in the API transaction that writes them; a schema cannot see the
 * sibling documents.
 */
export const AddressDocSchema = z.object({
  /** Customer's own name for it: "Home", "Amma's place". */
  label: z.string().min(1).max(40),
  ...PostalAddressSchema.shape,
  isDefault: z.boolean(),
  ...AuditTimestampsSchema.shape,
});
export type AddressDoc = z.infer<typeof AddressDocSchema>;

/**
 * `users/{uid}/wishlist/{productId}` — document ID is the product ID.
 *
 * Keying by product makes the toggle idempotent by construction: adding twice is
 * one document, and removing is a delete of a known path rather than a query.
 */
export const WishlistItemDocSchema = z.object({
  productId: ProductIdSchema,
  addedAt: InstantSchema,
});
export type WishlistItemDoc = z.infer<typeof WishlistItemDocSchema>;
