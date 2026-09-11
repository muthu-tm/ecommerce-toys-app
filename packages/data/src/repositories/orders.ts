import type { Query } from 'firebase-admin/firestore';

import type {
  Cursor,
  FulfilmentStatus,
  NotificationDoc,
  OrderDoc,
  OrderEventDoc,
  OrderStatus,
  Paged,
  RefundDoc,
  ReviewDoc,
} from '@romp/contracts';
import { AWAITING_ADMIN_ACTION_STATUSES, PUBLIC_REVIEW_STATUS } from '@romp/contracts';

import type { Caller, StoreContext } from '../context';
import { isStaff, requireOwnership, requireStaff, uidOf } from '../context';
import type { WithId } from '../converter';
import { converters } from '../converters';
import { decodeOrderCursor, encodeOrderCursor } from '../cursor';
import { COLLECTIONS, paths } from '../paths';

import { getDocument, runQuery } from './read';

/**
 * Orders, refunds, notifications and reviews.
 *
 * The same ownership contract as `accounts.ts`, and the same reason: the Admin SDK does
 * not consult security rules, so the filter written here is the whole control.
 *
 * One difference worth naming. Several of these are **list** reads where the owner is a
 * document field rather than a path segment, so the filter has to be in the query —
 * `where('userId', '==', uid)` — not a post-read check. Reading a page and then
 * discarding the foreign rows would return short pages, bill for documents the caller
 * may not see, and put another customer's data in this process's memory for no reason.
 */

/** An order, if the caller owns it or is staff. Otherwise a 404. */
export async function findOrder(
  ctx: StoreContext,
  caller: Caller,
  orderId: string,
): Promise<WithId<OrderDoc>> {
  const order = await getDocument(ctx, paths.order(orderId), converters.orders);

  return requireOwnership(caller, order, (candidate) => candidate.userId, {
    resource: 'order',
    id: orderId,
  });
}

/**
 * A customer's order history, newest first.
 *
 * `uid` is a parameter rather than being read from the caller, so staff can view a
 * customer's history for support — and so the ownership decision is visible at the call
 * site rather than implied.
 */
export async function listOrdersForUser(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
  options: { readonly limit?: number; readonly status?: OrderStatus } = {},
): Promise<readonly WithId<OrderDoc>[]> {
  if (uidOf(caller) !== uid) requireStaff(caller, { resource: 'orders' });

  let query = ctx.db
    .collection(COLLECTIONS.orders)
    .withConverter(converters.orders)
    // The ownership filter is in the query, so a foreign order is never read at all.
    .where('userId', '==', uid);

  if (options.status !== undefined) {
    query = query.where('status', '==', options.status);
  }

  return runQuery(query.orderBy('createdAt', 'desc').limit(options.limit ?? 20));
}

/**
 * The payment verification queue, oldest first.
 *
 * Oldest first is the whole point: this is a work queue, and a customer who submitted
 * proof twenty minutes ago should be looked at before one who submitted it two minutes
 * ago. Sorting newest-first would starve the oldest order in the queue, which is the one
 * whose reservation is closest to expiring.
 */
export async function listVerificationQueue(
  ctx: StoreContext,
  caller: Caller,
  options: { readonly limit?: number } = {},
): Promise<readonly WithId<OrderDoc>[]> {
  requireStaff(caller, { resource: 'orders' });

  const [status] = AWAITING_ADMIN_ACTION_STATUSES;
  if (status === undefined) return [];

  return runQuery(
    ctx.db
      .collection(COLLECTIONS.orders)
      .withConverter(converters.orders)
      .where('status', '==', status)
      .orderBy('createdAt', 'asc')
      .limit(options.limit ?? 50),
  );
}

/** Orders at a given fulfilment stage, for the packing and dispatch views. */
export async function listOrdersByFulfilmentStatus(
  ctx: StoreContext,
  caller: Caller,
  status: FulfilmentStatus,
  options: { readonly limit?: number } = {},
): Promise<readonly WithId<OrderDoc>[]> {
  requireStaff(caller, { resource: 'orders' });

  return runQuery(
    ctx.db
      .collection(COLLECTIONS.orders)
      .withConverter(converters.orders)
      .where('fulfilment.status', '==', status)
      .orderBy('createdAt', 'desc')
      .limit(options.limit ?? 50),
  );
}

/**
 * Finds an order by its customer-facing number.
 *
 * For support: a customer quotes `RMP-24817` on WhatsApp, not a random document ID. A
 * query rather than a `get`, because the human ID is deliberately **not** the document
 * ID — a guessable sequence must not address a document (`SECURITY.md` § enumeration).
 *
 * Staff-only. Exposing it to customers would turn a guessable number into an order
 * lookup, which is precisely what keeping the two identifiers separate prevents.
 */
/**
 * The generic admin order list — one filterable, cursor-paginated read behind the backoffice orders
 * screen.
 *
 * The single-purpose reads above (`listVerificationQueue`, `listOrdersByFulfilmentStatus`) each
 * answer one fixed question with a bare limit and no cursor, because a work queue is a top-of-list
 * view, not a browsable archive. This one is the archive: newest first, paged with an opaque cursor,
 * filterable by payment status OR fulfilment status. The two filters are deliberately exclusive —
 * combining them would need a composite index the query plan does not carry, and the backoffice
 * offers them as alternatives, not a matrix — so the caller passes at most one, and `status` wins if
 * both somehow arrive.
 *
 * A `humanId` short-circuits everything: a staff member searching `RMP-24817` wants that one order,
 * not a page, so the filters and cursor are ignored and a one-or-zero-item page is returned. That is
 * the search box, not the filter bar.
 */
export async function listOrders(
  ctx: StoreContext,
  caller: Caller,
  options: {
    readonly status?: OrderStatus;
    readonly fulfilmentStatus?: FulfilmentStatus;
    readonly humanId?: string;
    readonly limit?: number;
    readonly cursor?: Cursor | string;
  } = {},
): Promise<Paged<WithId<OrderDoc>>> {
  requireStaff(caller, { resource: 'orders' });

  // The search box: an exact human-ID lookup, ignoring filters and pagination.
  if (options.humanId !== undefined && options.humanId !== '') {
    const found = await findOrderByHumanId(ctx, caller, options.humanId);
    return { items: found === null ? [] : [found], nextCursor: null };
  }

  const limit = options.limit ?? 24;

  let query: Query<OrderDoc> = ctx.db
    .collection(COLLECTIONS.orders)
    .withConverter(converters.orders);

  if (options.status !== undefined) {
    query = query.where('status', '==', options.status);
  } else if (options.fulfilmentStatus !== undefined) {
    query = query.where('fulfilment.status', '==', options.fulfilmentStatus);
  }

  // The document ID is the final ordering component, so paging is total: without it two orders at
  // the same instant have no defined order and a cursor can land mid-tie, repeating or skipping. It
  // also means `startAfter` takes exactly two values, matching the two `orderBy` clauses.
  let ordered = query.orderBy('createdAt', 'desc').orderBy('__name__', 'desc');

  if (options.cursor !== undefined) {
    const decoded = decodeOrderCursor(options.cursor);
    ordered = ordered.startAfter(decoded.createdAt, decoded.documentId);
  }

  // Fetch one more than asked so "is there a next page" is answered without a second query.
  const rows = await runQuery(ordered.limit(limit + 1));
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const last = items.at(-1);
  const nextCursor: Cursor | null =
    hasMore && last !== undefined ? encodeOrderCursor(last.createdAt, last.id) : null;

  return { items, nextCursor };
}

export async function findOrderByHumanId(
  ctx: StoreContext,
  caller: Caller,
  humanId: string,
): Promise<WithId<OrderDoc> | null> {
  requireStaff(caller, { resource: 'order' });

  const results = await runQuery(
    ctx.db
      .collection(COLLECTIONS.orders)
      .withConverter(converters.orders)
      .where('humanId', '==', humanId)
      .limit(1),
  );

  return results[0] ?? null;
}

/**
 * An order's audit trail, oldest first.
 *
 * Chronological because it is read as a story — placed, then paid, then packed. Reads
 * the order first, so the ownership check happens once against the parent rather than
 * being inferred from the subcollection path.
 */
export async function listOrderEvents(
  ctx: StoreContext,
  caller: Caller,
  orderId: string,
): Promise<readonly WithId<OrderEventDoc>[]> {
  await findOrder(ctx, caller, orderId);

  return runQuery(
    ctx.db
      .collection(paths.orderEvents(orderId))
      .withConverter(converters.orderEvents)
      .orderBy('at', 'asc'),
  );
}

/**
 * Refunds against one order.
 *
 * Ownership is checked against the order, then the refunds are read by `orderId`. The
 * refund documents also carry a denormalised `userId` — that copy exists for the
 * *security rule*, which cannot afford a join; here the parent read is already needed to
 * produce a 404 for an order that does not exist.
 */
export async function listRefundsForOrder(
  ctx: StoreContext,
  caller: Caller,
  orderId: string,
): Promise<readonly WithId<RefundDoc>[]> {
  await findOrder(ctx, caller, orderId);

  return runQuery(
    ctx.db
      .collection(COLLECTIONS.refunds)
      .withConverter(converters.refunds)
      .where('orderId', '==', orderId)
      .orderBy('createdAt', 'asc'),
  );
}

/**
 * The caller's notification feed.
 *
 * Customers get their own; staff get the admin audience. Which of the two is decided by
 * the caller's role, not by a parameter — a `listNotifications(audience)` signature
 * would let a customer ask for the admin feed and rely on a filter further down to
 * refuse, and that filter is one refactor from being the only thing that mattered.
 */
export async function listNotifications(
  ctx: StoreContext,
  caller: Caller,
  options: { readonly limit?: number; readonly unreadOnly?: boolean } = {},
): Promise<readonly WithId<NotificationDoc>[]> {
  const limit = options.limit ?? 20;

  if (isStaff(caller)) {
    // Per-admin read state lives in a `readBy` map, and Firestore cannot filter on
    // "this map lacks my key". So the staff feed is read whole and unread-filtered in
    // memory — bounded by `limit`, so the cost is bounded too.
    const notifications = await runQuery(
      ctx.db
        .collection(COLLECTIONS.notifications)
        .withConverter(converters.notifications)
        .where('audience', '==', 'admin')
        .orderBy('createdAt', 'desc')
        .limit(limit),
    );

    if (options.unreadOnly !== true) return notifications;

    const uid = uidOf(caller);
    return notifications.filter((notification) => uid === null || !(uid in notification.readBy));
  }

  const uid = uidOf(caller);
  if (uid === null) return [];

  let query = ctx.db
    .collection(COLLECTIONS.notifications)
    .withConverter(converters.notifications)
    .where('userId', '==', uid);

  if (options.unreadOnly === true) {
    // `readAt` is written as an explicit null rather than omitted precisely so this
    // filter works — Firestore's `== null` matches a null field and not a missing one.
    query = query.where('readAt', '==', null);
  }

  return runQuery(query.orderBy('createdAt', 'desc').limit(limit));
}

/**
 * The unread count for the navbar bell.
 *
 * Capped rather than exact. A bell renders `99+` past two figures, so counting beyond
 * that is billing for a number nobody displays — and for the staff audience an exact
 * count is not obtainable by query at all, because "the `readBy` map lacks my uid" is
 * not a filter Firestore can express.
 */
export async function countUnreadNotifications(
  ctx: StoreContext,
  caller: Caller,
  options: { readonly cap?: number } = {},
): Promise<number> {
  const cap = options.cap ?? 99;
  const notifications = await listNotifications(ctx, caller, {
    limit: cap + 1,
    unreadOnly: true,
  });

  return notifications.length;
}

/**
 * Published reviews for a product.
 *
 * Public. Only `published` is visible, matching the security rule and
 * `PUBLIC_REVIEW_STATUS` — the same shared constant, so the storefront query and the
 * rule cannot disagree about which string that is.
 */
export async function listPublishedReviews(
  ctx: StoreContext,
  productId: string,
  options: { readonly limit?: number } = {},
): Promise<readonly WithId<ReviewDoc>[]> {
  return runQuery(
    ctx.db
      .collection(COLLECTIONS.reviews)
      .withConverter(converters.reviews)
      .where('productId', '==', productId)
      .where('status', '==', PUBLIC_REVIEW_STATUS)
      .orderBy('createdAt', 'desc')
      .limit(options.limit ?? 20),
  );
}

/**
 * A customer's own reviews, in any status.
 *
 * So they can see that a pending review was received rather than concluding the form is
 * broken. The rejection *reason* is on the document but is never rendered to them —
 * that is the caller's responsibility, and it is stated on `ReviewDoc.rejectionReason`.
 */
export async function listOwnReviews(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
  options: { readonly limit?: number } = {},
): Promise<readonly WithId<ReviewDoc>[]> {
  if (uidOf(caller) !== uid) requireStaff(caller, { resource: 'reviews' });

  return runQuery(
    ctx.db
      .collection(COLLECTIONS.reviews)
      .withConverter(converters.reviews)
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(options.limit ?? 20),
  );
}

/**
 * The moderation queue, oldest first.
 *
 * Oldest first for the same reason as the payment queue: a review submitted a week ago
 * that is still pending is the one the customer has given up on.
 */
export async function listModerationQueue(
  ctx: StoreContext,
  caller: Caller,
  options: { readonly limit?: number } = {},
): Promise<readonly WithId<ReviewDoc>[]> {
  requireStaff(caller, { resource: 'reviews' });

  return runQuery(
    ctx.db
      .collection(COLLECTIONS.reviews)
      .withConverter(converters.reviews)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'asc')
      .limit(options.limit ?? 50),
  );
}

/**
 * Whether this customer already has a review occupying the slot for a product.
 *
 * One `published` or `pending` review per `(userId, productId)`. `rejected` does not
 * occupy the slot, so a customer whose review was rejected may write another — which is
 * the point of not telling them why.
 */
export async function findReviewSlot(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
  productId: string,
): Promise<WithId<ReviewDoc> | null> {
  if (uidOf(caller) !== uid) requireStaff(caller, { resource: 'reviews' });

  const results = await runQuery(
    ctx.db
      .collection(COLLECTIONS.reviews)
      .withConverter(converters.reviews)
      .where('userId', '==', uid)
      .where('productId', '==', productId)
      .where('status', 'in', ['pending', PUBLIC_REVIEW_STATUS])
      .limit(1),
  );

  return results[0] ?? null;
}
