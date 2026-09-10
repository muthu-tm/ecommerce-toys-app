import type { EventType, NotificationType } from '@romp/contracts';

/**
 * The routing table: which notification each event produces, per audience.
 *
 * Data, not branching logic. The whole point of `NOTIFICATIONS.md` keeping this a table is
 * that it is exhaustively testable — every `EventType` has an entry — and readable in one
 * screen. Adding a recipient or retargeting an event is an edit here, never a change to the
 * feature that emits the event.
 *
 * `null` for an audience means "no notification for that audience", which is a deliberate
 * choice in several rows:
 *
 *  - A **rejected review** notifies nobody: rejection reasons are moderation judgements, and
 *    surfacing them invites argument for no value.
 *  - **Routine fulfilment steps** do not notify the admin who performed them — telling
 *    someone they did the thing they just did is the noise that makes a channel ignorable,
 *    and this is the only channel.
 */
export interface NotificationRoute {
  /** The notification type for the customer, or null if the customer is not notified. */
  readonly customer: NotificationType | null;
  /** The notification type for the admin audience, or null if the admins are not notified. */
  readonly admin: NotificationType | null;
}

export const NOTIFICATION_ROUTES: Readonly<Record<EventType, NotificationRoute>> = Object.freeze({
  'order.created': { customer: 'order_placed', admin: 'new_order' },
  'order.payment_submitted': {
    customer: 'payment_under_review',
    admin: 'payment_proof_submitted',
  },
  'order.payment_verified': { customer: 'payment_verified', admin: null },
  'order.payment_rejected': { customer: 'payment_rejected', admin: null },
  'order.expired': { customer: 'order_expired', admin: null },
  'order.packed': { customer: 'order_packed', admin: null },
  'order.shipped': { customer: 'order_shipped', admin: null },
  'order.delivered': { customer: 'order_delivered', admin: null },
  'order.cancelled': { customer: 'order_cancelled', admin: null },
  'refund.issued': { customer: 'refund_issued', admin: null },
  'review.submitted': { customer: null, admin: 'review_pending' },
  'review.published': { customer: 'review_published', admin: null },
  'review.rejected': { customer: null, admin: null },
  'inventory.low_stock': { customer: null, admin: 'low_stock' },
  'inventory.out_of_stock': { customer: null, admin: 'out_of_stock' },
  'sweeper.anomaly': { customer: null, admin: 'sweeper_anomaly' },
});
