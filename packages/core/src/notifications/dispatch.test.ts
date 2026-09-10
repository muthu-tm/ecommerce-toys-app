import { describe, expect, it } from 'vitest';

import type { EventType, NotificationType, StoredEvent } from '@romp/contracts';
import { EventIdSchema, EventTypeSchema, NotificationTypeSchema, money } from '@romp/contracts';

import type { NotificationContent } from './dispatch';
import { planNotifications } from './dispatch';
import { NOTIFICATION_ROUTES } from './routing';

const AT = new Date('2026-03-01T09:30:00.000Z');
const TTL_DAYS = 30;
const ADMINS = ['admin-1', 'admin-2'];

/** A content bundle whose templates echo their tokens, so a test can assert interpolation. */
function content(): NotificationContent {
  const templates = Object.fromEntries(
    NotificationTypeSchema.options.map((type) => [
      type,
      { title: `${type} {orderRef}`, body: `{amount} {carrier} {trackingNo} {sku}` },
    ]),
  ) as NotificationContent['templates'];
  return { templates, moneyFormat: { locale: 'en-IN', currency: 'INR' } };
}

/** A stored event for a given type, with a payload sufficient for the routing under test. */
function storedEvent(type: EventType): StoredEvent {
  const orderBase = {
    orderId: 'order-0001',
    humanId: 'RMP-24817',
    userId: 'cust-1',
  };
  const payloads: Record<EventType, StoredEvent['payload']> = {
    'order.created': { type, ...orderBase, totalMinor: money(129_900), itemCount: 2 } as never,
    'order.payment_submitted': { type, ...orderBase, hasScreenshot: true } as never,
    'order.payment_verified': { type, ...orderBase, verifiedBy: 'admin-1' } as never,
    'order.payment_rejected': {
      type,
      ...orderBase,
      rejectedBy: 'admin-1',
      reason: 'no match',
    } as never,
    'order.expired': { type, ...orderBase } as never,
    'order.packed': { type, ...orderBase } as never,
    'order.shipped': { type, ...orderBase, carrier: 'BlueDart', trackingNo: 'BD123' } as never,
    'order.delivered': { type, ...orderBase } as never,
    'order.cancelled': { type, ...orderBase, reason: 'customer request' } as never,
    'refund.issued': {
      type,
      ...orderBase,
      refundId: 'refund-1',
      amountMinor: money(50_000),
    } as never,
    'review.submitted': {
      type,
      reviewId: 'rev-1',
      productId: 'wooden-blocks',
      userId: 'cust-1',
    } as never,
    'review.published': {
      type,
      reviewId: 'rev-1',
      productId: 'wooden-blocks',
      productSlug: 'wooden-blocks',
      userId: 'cust-1',
    } as never,
    'review.rejected': {
      type,
      reviewId: 'rev-1',
      productId: 'wooden-blocks',
      userId: 'cust-1',
      reason: 'spam',
    } as never,
    'inventory.low_stock': {
      type,
      variantId: 'WB-240',
      productId: 'wooden-blocks',
      sku: 'WB-240',
      warehouseId: 'blr',
      remaining: 2,
    } as never,
    'inventory.out_of_stock': {
      type,
      variantId: 'WB-240',
      productId: 'wooden-blocks',
      sku: 'WB-240',
    } as never,
    'sweeper.anomaly': { type, detail: 'stuck', affectedCount: 3 } as never,
  };
  return {
    id: EventIdSchema.parse(`event-${type}`),
    type,
    actorId: 'system',
    subject: { kind: 'order', id: 'order-0001' },
    payload: payloads[type],
    at: AT,
  };
}

function plan(type: EventType) {
  return planNotifications({
    event: storedEvent(type),
    adminUids: ADMINS,
    content: content(),
    ttlDays: TTL_DAYS,
  });
}

describe('the routing table', () => {
  it('has an entry for every event type', () => {
    for (const type of EventTypeSchema.options) {
      expect(NOTIFICATION_ROUTES[type]).toBeDefined();
    }
    expect(Object.keys(NOTIFICATION_ROUTES)).toHaveLength(EventTypeSchema.options.length);
  });

  it('only routes to notification types that exist', () => {
    const known = new Set<NotificationType>(NotificationTypeSchema.options);
    for (const route of Object.values(NOTIFICATION_ROUTES)) {
      if (route.customer !== null) expect(known.has(route.customer)).toBe(true);
      if (route.admin !== null) expect(known.has(route.admin)).toBe(true);
    }
  });
});

describe('planNotifications', () => {
  it('produces a customer and an admin notification for order.created', () => {
    const result = plan('order.created');
    const audiences = result.map((r) => r.doc.audience).sort();
    expect(audiences).toEqual(['admin', 'user']);
  });

  it('addresses the customer notification to the payload uid', () => {
    const result = plan('order.created');
    const customer = result.find((r) => r.doc.audience === 'user');
    expect(customer?.doc.userId).toBe('cust-1');
  });

  it('gives the admin notification a null userId and empty readBy', () => {
    const result = plan('order.created');
    const admin = result.find((r) => r.doc.audience === 'admin');
    expect(admin?.doc.userId).toBeNull();
    expect(admin?.doc.readBy).toEqual({});
  });

  it('derives deterministic IDs from the event id, audience and recipient', () => {
    const result = plan('order.created');
    const customer = result.find((r) => r.doc.audience === 'user');
    const admin = result.find((r) => r.doc.audience === 'admin');
    expect(customer?.id).toBe('event-order.created_user_cust-1');
    expect(admin?.id).toBe('event-order.created_admin_all');
  });

  it('is idempotent: the same event twice yields the same IDs', () => {
    const first = plan('order.created').map((r) => r.id);
    const second = plan('order.created').map((r) => r.id);
    expect(first).toEqual(second);
  });

  it('interpolates the order reference and amount from the payload', () => {
    const result = plan('order.created');
    const customer = result.find((r) => r.doc.audience === 'user');
    expect(customer?.doc.title).toContain('RMP-24817');
    // ₹1,299.00 for the seeded paise, formatted for the store locale.
    expect(customer?.doc.body).toContain('1,299');
  });

  it('interpolates carrier and tracking on a shipped event', () => {
    const result = plan('order.shipped');
    const customer = result.find((r) => r.doc.audience === 'user');
    expect(customer?.doc.body).toContain('BlueDart');
    expect(customer?.doc.body).toContain('BD123');
  });

  it('notifies only the admin for a review submission', () => {
    const result = plan('review.submitted');
    expect(result).toHaveLength(1);
    expect(result[0]?.doc.audience).toBe('admin');
  });

  it('notifies nobody for a rejected review', () => {
    expect(plan('review.rejected')).toEqual([]);
  });

  it('sets a customer deep link to the order', () => {
    const result = plan('order.created');
    const customer = result.find((r) => r.doc.audience === 'user');
    expect(customer?.doc.link).toBe('/account/orders/RMP-24817');
  });

  it('sets expiresAt from the TTL relative to the event time', () => {
    const result = plan('order.created');
    const doc = result[0]?.doc;
    const expectedExpiry = AT.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(doc?.expiresAt.getTime()).toBe(expectedExpiry);
    expect(doc?.createdAt.getTime()).toBe(AT.getTime());
  });

  it('every event type produces only valid notification documents', () => {
    // Exhaustive: every route resolves and every produced doc has the right shape.
    for (const type of EventTypeSchema.options) {
      const result = plan(type);
      const route = NOTIFICATION_ROUTES[type];
      const expectCustomer = route.customer !== null; // all customer-routed events here carry a userId
      const expectAdmin = route.admin !== null;
      const audiences = new Set(result.map((r) => r.doc.audience));
      expect(audiences.has('user')).toBe(expectCustomer);
      expect(audiences.has('admin')).toBe(expectAdmin);
    }
  });
});
