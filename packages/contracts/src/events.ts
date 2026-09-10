import { z } from 'zod';

import { HumanOrderIdSchema, SkuSchema, SlugSchema } from './primitives/identifiers';
import {
  ActorIdSchema,
  EventIdSchema,
  OrderIdSchema,
  ProductIdSchema,
  RefundIdSchema,
  ReviewIdSchema,
  UidSchema,
  VariantIdSchema,
  WarehouseIdSchema,
} from './primitives/ids';
import { InstantSchema } from './primitives/instant';
import { MoneySchema } from './primitives/money';

/**
 * The event spine.
 *
 * `events` is append-only and immutable, written **in the same transaction as the
 * state change it describes**. Notifications are a *projection* of it, not the
 * other way round, which is what makes a dispatcher outage recoverable: fix the
 * bug, replay the events, and because notification IDs are derived from
 * `(eventId, audience, recipient)` the replay overwrites rather than duplicates.
 *
 * The same collection serves the security audit trail — every verification, refund
 * and price change carries its actor — so one append-only log satisfies both needs
 * and neither is bolted onto the other.
 *
 * Events are facts about the past, named `noun.verb-past-tense`. Present-tense or
 * imperative names ("send email", "verify payment") describe intent, and intent
 * belongs in a queue, not in an audit log.
 */

export const EventTypeSchema = z.enum([
  'order.created',
  'order.payment_submitted',
  'order.payment_verified',
  'order.payment_rejected',
  'order.expired',
  'order.packed',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'refund.issued',
  'review.submitted',
  'review.published',
  'review.rejected',
  'inventory.low_stock',
  'inventory.out_of_stock',
  'sweeper.anomaly',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSubjectKindSchema = z.enum(['order', 'product', 'variant', 'review', 'refund']);
export type EventSubjectKind = z.infer<typeof EventSubjectKindSchema>;

/**
 * Fields shared by every order event.
 *
 * `humanId` is denormalised onto the event so notification copy can name the order
 * without the dispatcher reading it back — a read that would be one more thing to
 * fail while fanning out, for a value that cannot change after the order exists.
 */
const orderEventBase = {
  orderId: OrderIdSchema,
  humanId: HumanOrderIdSchema,
  userId: UidSchema,
};

/**
 * Per-type payloads as a discriminated union on `type`.
 *
 * A union rather than a permissive `Record<string, unknown>`: the dispatcher and
 * the copy templates read specific fields, so a producer omitting `trackingNo` from
 * `order.shipped` should fail where it is written, not render a notification saying
 * "your order shipped with undefined".
 */
export const EventPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('order.created'),
    ...orderEventBase,
    totalMinor: MoneySchema,
    itemCount: z.int().positive(),
  }),
  z.object({
    type: z.literal('order.payment_submitted'),
    ...orderEventBase,
    hasScreenshot: z.boolean(),
  }),
  z.object({
    type: z.literal('order.payment_verified'),
    ...orderEventBase,
    verifiedBy: UidSchema,
  }),
  z.object({
    type: z.literal('order.payment_rejected'),
    ...orderEventBase,
    rejectedBy: UidSchema,
    reason: z.string().min(1).max(500),
  }),
  z.object({ type: z.literal('order.expired'), ...orderEventBase }),
  z.object({ type: z.literal('order.packed'), ...orderEventBase }),
  z.object({
    type: z.literal('order.shipped'),
    ...orderEventBase,
    carrier: z.string().min(1).max(100),
    trackingNo: z.string().min(1).max(100),
  }),
  z.object({ type: z.literal('order.delivered'), ...orderEventBase }),
  z.object({
    type: z.literal('order.cancelled'),
    ...orderEventBase,
    reason: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('refund.issued'),
    ...orderEventBase,
    refundId: RefundIdSchema,
    amountMinor: MoneySchema,
  }),
  z.object({
    type: z.literal('review.submitted'),
    reviewId: ReviewIdSchema,
    productId: ProductIdSchema,
    userId: UidSchema,
  }),
  z.object({
    type: z.literal('review.published'),
    reviewId: ReviewIdSchema,
    productId: ProductIdSchema,
    productSlug: SlugSchema,
    userId: UidSchema,
  }),
  z.object({
    type: z.literal('review.rejected'),
    reviewId: ReviewIdSchema,
    productId: ProductIdSchema,
    userId: UidSchema,
    reason: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('inventory.low_stock'),
    variantId: VariantIdSchema,
    productId: ProductIdSchema,
    sku: SkuSchema,
    warehouseId: WarehouseIdSchema,
    remaining: z.int().nonnegative(),
  }),
  z.object({
    type: z.literal('inventory.out_of_stock'),
    variantId: VariantIdSchema,
    productId: ProductIdSchema,
    sku: SkuSchema,
  }),
  z.object({
    type: z.literal('sweeper.anomaly'),
    detail: z.string().min(1).max(1_000),
    affectedCount: z.int().nonnegative(),
  }),
]);
export type EventPayload = z.infer<typeof EventPayloadSchema>;

/** Narrows the payload union to one event type. */
export type EventPayloadOf<TType extends EventType> = Extract<EventPayload, { type: TType }>;

/**
 * `events/{eventId}` as stored — the document body, without its ID.
 *
 * `at` is a `Date` here and a Firestore `Timestamp` at rest. The converter in
 * `@romp/data` owns that conversion; importing a Firestore type into this package
 * would drag the SDK into every consumer, including the browser bundle.
 *
 * Written **in the same transaction as the state change it describes**, and never
 * mutated afterwards. Rules deny every client access to this collection: it is the
 * internal spine, and it carries actor identities for the whole store.
 */
export const EventDocSchema = z.object({
  type: EventTypeSchema,
  actorId: ActorIdSchema,
  subject: z.object({ kind: EventSubjectKindSchema, id: z.string().min(1).max(1_500) }),
  payload: EventPayloadSchema,
  at: InstantSchema,
});
export type EventDoc = z.infer<typeof EventDocSchema>;

/**
 * An event with its document ID attached, which is the form the dispatcher works
 * in — notification IDs are derived from the event ID, so a decoded event that had
 * lost its ID would be undispatchable.
 */
export const StoredEventSchema = EventDocSchema.extend({ id: EventIdSchema });
export type StoredEvent = z.infer<typeof StoredEventSchema>;

/** Which subject kind each event type is about, for indexing and audit queries. */
export const EVENT_SUBJECT_KIND: Readonly<Record<EventType, EventSubjectKind>> = Object.freeze({
  'order.created': 'order',
  'order.payment_submitted': 'order',
  'order.payment_verified': 'order',
  'order.payment_rejected': 'order',
  'order.expired': 'order',
  'order.packed': 'order',
  'order.shipped': 'order',
  'order.delivered': 'order',
  'order.cancelled': 'order',
  'refund.issued': 'refund',
  'review.submitted': 'review',
  'review.published': 'review',
  'review.rejected': 'review',
  'inventory.low_stock': 'variant',
  'inventory.out_of_stock': 'variant',
  'sweeper.anomaly': 'order',
});

/** Notification audiences. */
export const AudienceSchema = z.enum(['user', 'admin']);
export type Audience = z.infer<typeof AudienceSchema>;

/**
 * Notification kinds — the copy template to render, distinct from the event that
 * caused it. One event can produce different notifications for different audiences
 * (`order.created` → `order_placed` for the customer, `new_order` for staff), so
 * they cannot share one enum.
 */
export const NotificationTypeSchema = z.enum([
  'order_placed',
  'new_order',
  'payment_under_review',
  'payment_proof_submitted',
  'payment_verified',
  'payment_rejected',
  'order_expired',
  'order_packed',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'refund_issued',
  'review_pending',
  'review_published',
  'low_stock',
  'out_of_stock',
  'sweeper_anomaly',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
