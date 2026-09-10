import { describe, expect, it } from 'vitest';

import {
  EVENT_SUBJECT_KIND,
  EventPayloadSchema,
  EventTypeSchema,
  NotificationTypeSchema,
} from './events';
import type { EventPayloadOf } from './events';

describe('event catalogue', () => {
  it('names every event in the past tense', () => {
    // Events are facts about the past. An imperative name describes intent, and
    // intent belongs in a queue, not in an append-only audit log.
    for (const type of EventTypeSchema.options) {
      expect(type).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it('maps every event type to a subject kind', () => {
    // Missing entries would only surface when an audit query returned nothing.
    for (const type of EventTypeSchema.options) {
      expect(EVENT_SUBJECT_KIND[type]).toBeDefined();
    }
    expect(Object.keys(EVENT_SUBJECT_KIND)).toHaveLength(EventTypeSchema.options.length);
  });

  it('has a payload schema for every declared event type', () => {
    // An event type in the enum with no payload member would be a producer that
    // cannot write its own event. Each type must parse far enough to complain
    // about its *own* fields rather than about an unrecognised discriminator.
    for (const type of EventTypeSchema.options) {
      const issues = EventPayloadSchema.safeParse({ type }).error?.issues ?? [];

      expect(
        issues.some((issue) => issue.code === 'invalid_union'),
        `no payload schema is registered for "${type}"`,
      ).toBe(false);
    }
  });

  it('rejects an event type that is not in the catalogue', () => {
    // Proves the assertion above is meaningful: an unknown discriminator really
    // does produce invalid_union, so its absence above is evidence of coverage.
    const issues = EventPayloadSchema.safeParse({ type: 'order.teleported' }).error?.issues ?? [];

    expect(issues.some((issue) => issue.code === 'invalid_union')).toBe(true);
  });
});

describe('order event payloads', () => {
  const base = {
    orderId: 'order-1',
    humanId: 'RMP-24817',
    userId: 'uid-1',
  };

  it('accepts a well-formed order.created', () => {
    const parsed = EventPayloadSchema.parse({
      type: 'order.created',
      ...base,
      totalMinor: 384_998,
      itemCount: 3,
    });

    expect(parsed).toMatchObject({ type: 'order.created', totalMinor: 384_998 });
  });

  it('rejects a total that is not integer paise', () => {
    const result = EventPayloadSchema.safeParse({
      type: 'order.created',
      ...base,
      totalMinor: 3849.98,
      itemCount: 3,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an order event with a malformed human ID', () => {
    const result = EventPayloadSchema.safeParse({
      type: 'order.delivered',
      ...base,
      humanId: 'not-an-order-number',
    });

    expect(result.success).toBe(false);
  });

  it('requires carrier and tracking on order.shipped', () => {
    // Otherwise the notification renders "your order shipped with undefined".
    expect(EventPayloadSchema.safeParse({ type: 'order.shipped', ...base }).success).toBe(false);

    const parsed = EventPayloadSchema.parse({
      type: 'order.shipped',
      ...base,
      carrier: 'Delhivery',
      trackingNo: 'DL123456789',
    });

    expect(parsed).toMatchObject({ carrier: 'Delhivery' });
  });

  it('requires a reason on rejection and cancellation', () => {
    expect(
      EventPayloadSchema.safeParse({
        type: 'order.payment_rejected',
        ...base,
        rejectedBy: 'admin-1',
      }).success,
    ).toBe(false);
    expect(EventPayloadSchema.safeParse({ type: 'order.cancelled', ...base }).success).toBe(false);
  });

  it('requires the acting admin on verification', () => {
    // Reaching `paid` must always name a person. It is the audit record that
    // answers "who marked this paid".
    expect(EventPayloadSchema.safeParse({ type: 'order.payment_verified', ...base }).success).toBe(
      false,
    );
  });

  it('narrows the union by discriminator', () => {
    const payload = EventPayloadSchema.parse({
      type: 'order.shipped',
      ...base,
      carrier: 'Delhivery',
      trackingNo: 'DL1',
    });

    if (payload.type !== 'order.shipped') throw new Error('expected order.shipped');
    const shipped: EventPayloadOf<'order.shipped'> = payload;
    expect(shipped.trackingNo).toBe('DL1');
  });
});

describe('inventory event payloads', () => {
  it('normalises the SKU it carries', () => {
    const parsed = EventPayloadSchema.parse({
      type: 'inventory.low_stock',
      variantId: 'variant-1',
      productId: 'product-1',
      sku: 'brk-2401',
      warehouseId: 'blr',
      remaining: 2,
    });

    expect(parsed).toMatchObject({ sku: 'BRK-2401' });
  });

  it('allows a remaining count of zero but not a negative one', () => {
    const shape = {
      type: 'inventory.low_stock' as const,
      variantId: 'variant-1',
      productId: 'product-1',
      sku: 'BRK-2401',
      warehouseId: 'blr',
    };

    expect(EventPayloadSchema.safeParse({ ...shape, remaining: 0 }).success).toBe(true);
    expect(EventPayloadSchema.safeParse({ ...shape, remaining: -1 }).success).toBe(false);
  });

  it('rejects an uppercase warehouse ID', () => {
    // Warehouse IDs are their lowercase code and double as document IDs.
    expect(
      EventPayloadSchema.safeParse({
        type: 'inventory.low_stock',
        variantId: 'v',
        productId: 'p',
        sku: 'S1',
        warehouseId: 'BLR',
        remaining: 1,
      }).success,
    ).toBe(false);
  });
});

describe('notification types', () => {
  it('separates notification kinds from event types', () => {
    // One event fans out to different notifications per audience, so they cannot
    // share an enum: order.created → order_placed (customer) and new_order (staff).
    const overlap = NotificationTypeSchema.options.filter((type) =>
      (EventTypeSchema.options as readonly string[]).includes(type),
    );

    expect(overlap).toEqual([]);
    expect(NotificationTypeSchema.options).toContain('order_placed');
    expect(NotificationTypeSchema.options).toContain('new_order');
  });

  it('has no notification kind for a rejected review', () => {
    // Deliberate: rejection reasons are moderation judgements. Surfacing them
    // invites argument and adds nothing — the review simply never appears.
    expect(NotificationTypeSchema.options).not.toContain('review_rejected');
  });
});
