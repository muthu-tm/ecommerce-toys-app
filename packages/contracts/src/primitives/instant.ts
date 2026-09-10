import { z } from 'zod';

/**
 * A point in time, as it appears once a document has been decoded.
 *
 * Firestore stores these as `Timestamp`, but this package must not import the
 * Firebase SDK — it is consumed by the browser bundle, and a Firestore type
 * reaching in here would drag the SDK with it. So the contract is expressed in
 * the one instant type that both sides already have: `Date`.
 *
 * The conversion is owned by the converters in `@romp/data`, which map
 * `Timestamp → Date` before parsing and `Date → Timestamp` after. That is the
 * only place the two representations meet, which is deliberate: a `Timestamp`
 * leaking into application code is how `order.createdAt.getTime()` becomes a
 * runtime error that only fires on the server.
 *
 * **Server timestamps are not instants.** `FieldValue.serverTimestamp()` is a
 * sentinel, not a value, so it cannot satisfy this schema. Writes that need
 * server time resolve it before validating — see `@romp/data`'s `now()` seam —
 * rather than smuggling a sentinel through a validated document.
 */
export const InstantSchema = z.date({
  error: 'Expected a Date. Firestore Timestamps are converted before validation.',
});

export type Instant = z.infer<typeof InstantSchema>;

/**
 * An instant that may legitimately be absent, stored as `null` rather than
 * omitted.
 *
 * Explicit `null` over an optional field, because Firestore treats a missing
 * field and a null field differently in queries: `where('readAt', '==', null)`
 * matches the second and not the first. Making absence a written value keeps
 * "unread" queryable, and keeps the field's existence independent of whether it
 * has happened yet.
 */
export const NullableInstantSchema = InstantSchema.nullable();

/**
 * Compares two instants for equality by their epoch value.
 *
 * `Date` is a reference type, so `===` on two decodes of the same timestamp is
 * false. This is used by the seed's idempotency check, where a false inequality
 * would make a re-run look like a change.
 */
export function instantsEqual(left: Instant | null, right: Instant | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}
