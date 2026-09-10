import type { Transaction } from 'firebase-admin/firestore';

import type { EventDoc, NotificationDoc, StoredEvent } from '@romp/contracts';

import type { StoreContext } from '../context';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

/**
 * The event spine and notification writes.
 *
 * The `events` collection is the append-only source of truth: a feature emits a fact about
 * the past, and everything downstream — notifications, analytics, the audit trail — is
 * derived from it. Nothing here mutates an event; the only operations are append and, for
 * notifications, an idempotent set keyed by a deterministic ID.
 *
 * These take a `StoreContext` but no `Caller`: they are written by the API (in the same
 * transaction as the state change the event describes) and by the dispatcher (a `system`
 * caller), never by a customer. Rules deny every client access to both collections.
 */

/**
 * Appends an event to the spine and returns it with its generated ID.
 *
 * A plain `add`, because an event is immutable once written — there is no read-modify-write
 * to serialise. The converter validates the document and converts its `Date` fields to
 * `Timestamp`, so a malformed event fails here rather than being read back wrong by the
 * dispatcher.
 */
export async function appendEvent(ctx: StoreContext, event: EventDoc): Promise<StoredEvent> {
  const ref = await ctx.db
    .collection(COLLECTIONS.events)
    .withConverter(converters.events)
    .add(event);
  return { ...event, id: ref.id } as StoredEvent;
}

/**
 * Appends an event inside an existing transaction, returning the ID it will have.
 *
 * This is the form the money-critical writes use (Task 16+): the event that says "order
 * placed" must commit in the **same transaction** as the reservation and inventory
 * decrement it describes, or a crash between them leaves an event with no state change or a
 * state change with no event. The ID is allocated up front (`doc()` with no path) so the
 * caller knows it before commit — a notification's ID derives from it.
 */
export function appendEventInTransaction(
  tx: Transaction,
  ctx: StoreContext,
  event: EventDoc,
): StoredEvent {
  const ref = ctx.db.collection(COLLECTIONS.events).withConverter(converters.events).doc();
  tx.set(ref, event);
  return { ...event, id: ref.id } as StoredEvent;
}

/**
 * Writes a notification with a `set`, which is what makes replay idempotent.
 *
 * The ID is the deterministic `(eventId, audience, recipient)` key from `@romp/contracts`,
 * so re-running the dispatcher over an event range after an outage overwrites the same
 * documents rather than creating duplicates. `set` (not `create`) is deliberate: the second
 * write of the same event must succeed as a no-op-shaped overwrite, not fail.
 */
export async function writeNotification(
  ctx: StoreContext,
  notificationId: string,
  notification: NotificationDoc,
): Promise<void> {
  await ctx.db
    .doc(paths.notification(notificationId))
    .withConverter(converters.notifications)
    .set(notification);
}

/**
 * The most recent events, newest first — the window the backlog alarm inspects.
 *
 * Bounded by `limit`: the alarm asks "is the dispatcher keeping up with recent traffic",
 * which a recent window answers without scanning the whole append-only spine.
 */
export async function listRecentEvents(
  ctx: StoreContext,
  limit: number,
): Promise<readonly StoredEvent[]> {
  const snapshot = await ctx.db
    .collection(COLLECTIONS.events)
    .withConverter(converters.events)
    .orderBy('at', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as StoredEvent);
}

/**
 * Whether any notification has been written for an event.
 *
 * The backlog alarm uses this to tell a dispatched event from a stuck one. It queries by
 * `eventId` rather than reconstructing the deterministic notification IDs, so it does not
 * need to know the routing — one existing notification means the dispatcher ran.
 */
export async function notificationsExistForEvent(
  ctx: StoreContext,
  eventId: string,
): Promise<boolean> {
  const snapshot = await ctx.db
    .collection(COLLECTIONS.notifications)
    .where('eventId', '==', eventId)
    .limit(1)
    .get();
  return !snapshot.empty;
}
