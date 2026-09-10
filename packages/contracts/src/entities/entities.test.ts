import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { EventDocSchema } from '../events';
import { CategoryIdSchema, UidSchema, WarehouseIdSchema } from '../primitives/ids';
import { money } from '../primitives/money';

import { CartDocSchema } from './cart';
import {
  aCart,
  aCategory,
  aCounter,
  aLedgerEntry,
  aNotification,
  aPaymentRefGuard,
  aProduct,
  aRefund,
  aReservation,
  aReview,
  aUser,
  aVariant,
  aWarehouse,
  aWishlistItem,
  anAddress,
  anAdminNotification,
  anIdentityIndexEntry,
  anInventoryRecord,
  anOrder,
  anOrderEvent,
  checkoutSettings,
  dailyAnalytics,
  FIXTURE_LATER,
  FIXTURE_NOW,
} from './fixtures';
import {
  InventoryDocSchema,
  InventoryLedgerDocSchema,
  ReservationDocSchema,
  WarehouseDocSchema,
} from './inventory';
import { NotificationDocSchema, notificationId } from './notification';
import {
  CounterDocSchema,
  OrderDocSchema,
  OrderEventDocSchema,
  PaymentRefGuardDocSchema,
} from './order';
import { CategoryDocSchema, ProductDocSchema, VariantDocSchema } from './product';
import { RefundDocSchema } from './refund';
import { ReviewDocSchema } from './review';
import { CheckoutSettingsDocSchema, DailyAnalyticsDocSchema } from './settings';
import {
  AddressDocSchema,
  IdentityIndexDocSchema,
  UserDocSchema,
  WishlistItemDocSchema,
} from './user';

const BLR = WarehouseIdSchema.parse('blr');
const DEL = WarehouseIdSchema.parse('del');
const STAFF_UID = UidSchema.parse('staff-uid-0001');

/**
 * Asserts a schema rejects a document, and that the failure points at the field a
 * reader would need to fix.
 *
 * The path assertion is the part that matters. A refinement with the wrong `path`
 * still fails the document, so a test that only checked `success === false` would
 * pass while the API returned a field-level error against a field the customer
 * cannot see. That is how a validation message ends up attached to the wrong input.
 */
function expectRejection(
  schema: { safeParse: (value: unknown) => z.ZodSafeParseResult<unknown> },
  document: unknown,
  path: readonly (string | number)[],
): void {
  const result = schema.safeParse(document);
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues.map((issue) => issue.path)).toContainEqual([...path]);
}

/**
 * Every schema must accept its fixture. This is not a formality: the fixtures are
 * shared with `@romp/data`, the seed and every later task's tests, so a fixture
 * that has drifted out of validity would silently weaken all of them.
 */
describe('every document fixture is valid', () => {
  const cases = [
    ['warehouse', WarehouseDocSchema, aWarehouse()],
    ['category', CategoryDocSchema, aCategory()],
    ['product', ProductDocSchema, aProduct()],
    ['variant', VariantDocSchema, aVariant()],
    ['inventory', InventoryDocSchema, anInventoryRecord()],
    ['inventory ledger entry', InventoryLedgerDocSchema, aLedgerEntry()],
    ['reservation', ReservationDocSchema, aReservation()],
    ['user', UserDocSchema, aUser()],
    ['identity index entry', IdentityIndexDocSchema, anIdentityIndexEntry()],
    ['address', AddressDocSchema, anAddress()],
    ['wishlist item', WishlistItemDocSchema, aWishlistItem()],
    ['cart', CartDocSchema, aCart()],
    ['order', OrderDocSchema, anOrder()],
    ['order event', OrderEventDocSchema, anOrderEvent()],
    ['payment reference guard', PaymentRefGuardDocSchema, aPaymentRefGuard()],
    ['counter', CounterDocSchema, aCounter()],
    ['customer notification', NotificationDocSchema, aNotification()],
    ['staff notification', NotificationDocSchema, anAdminNotification()],
    ['review', ReviewDocSchema, aReview()],
    ['refund', RefundDocSchema, aRefund()],
    ['checkout settings', CheckoutSettingsDocSchema, checkoutSettings()],
    ['daily analytics', DailyAnalyticsDocSchema, dailyAnalytics()],
  ] as const;

  for (const [label, schema, document] of cases) {
    it(`accepts the ${label} fixture`, () => {
      const result = schema.safeParse(document);
      // Surface the actual issues rather than a bare `false`, or a fixture drift
      // becomes a guessing game.
      expect(result.success ? [] : result.error.issues).toEqual([]);
    });
  }
});

describe('documents strip unknown keys rather than rejecting them', () => {
  it('drops a field a newer deploy added', () => {
    // A rolling deploy has both versions reading the same documents. A strict
    // schema would turn that overlap into a storefront outage.
    const parsed = WarehouseDocSchema.parse({ ...aWarehouse(), fromTheFuture: 'ignored' });
    expect(parsed).not.toHaveProperty('fromTheFuture');
  });
});

describe('product', () => {
  it('rejects an MRP below the selling price', () => {
    expectRejection(
      ProductDocSchema,
      aProduct({ mrpFromMinor: money(aProduct().priceFromMinor - 1) }),
      ['mrpFromMinor'],
    );
  });

  it('rejects an active product with no active variant', () => {
    const summary = aProduct().variantSummary.map((variant) => ({ ...variant, active: false }));
    expectRejection(ProductDocSchema, aProduct({ status: 'active', variantSummary: summary }), [
      'variantSummary',
    ]);
  });

  it('allows a draft product with no active variant', () => {
    // The invariant is about what customers can buy, not about what an editor can
    // work on. A draft with everything switched off is a normal work in progress.
    const summary = aProduct().variantSummary.map((variant) => ({ ...variant, active: false }));
    expect(
      ProductDocSchema.safeParse(aProduct({ status: 'draft', variantSummary: summary })).success,
    ).toBe(true);
  });

  it('rejects a stored rating average with no ratings behind it', () => {
    expectRejection(ProductDocSchema, aProduct({ ratingCount: 0, ratingAvg: 4.6 }), ['ratingAvg']);
  });

  it('accepts an unrated product with a zero average', () => {
    expect(ProductDocSchema.safeParse(aProduct({ ratingCount: 0, ratingAvg: 0 })).success).toBe(
      true,
    );
  });

  it('rejects duplicate media order values', () => {
    const cover = aProduct().media[0];
    expect(cover).toBeDefined();
    if (cover === undefined) return;
    expectRejection(ProductDocSchema, aProduct({ media: [cover, { ...cover, path: 'b.webp' }] }), [
      'media',
    ]);
  });

  it('requires alt text on every image', () => {
    const cover = aProduct().media[0];
    if (cover === undefined) throw new Error('fixture has no cover image');
    expectRejection(ProductDocSchema, aProduct({ media: [{ ...cover, alt: '' }] }), [
      'media',
      0,
      'alt',
    ]);
  });

  it('requires a certificate number behind a BIS claim', () => {
    expectRejection(
      ProductDocSchema,
      aProduct({ safety: { ...aProduct().safety, bisCertNo: null } }),
      ['safety', 'bisCertNo'],
    );
  });

  it('requires an expiry behind a BIS claim', () => {
    expectRejection(
      ProductDocSchema,
      aProduct({ safety: { ...aProduct().safety, bisCertExpiry: null } }),
      ['safety', 'bisCertExpiry'],
    );
  });

  it('allows an uncertified product to carry neither', () => {
    expect(
      ProductDocSchema.safeParse(
        aProduct({
          safety: {
            bisCertified: false,
            bisCertNo: null,
            bisCertExpiry: null,
            bpaFree: true,
            hasSmallParts: true,
          },
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects a variant whose MRP is below its price', () => {
    expectRejection(VariantDocSchema, aVariant({ mrpMinor: money(aVariant().priceMinor - 1) }), [
      'mrpMinor',
    ]);
  });

  it('accepts a top-level and a nested category', () => {
    expect(CategoryDocSchema.safeParse(aCategory({ parentId: null })).success).toBe(true);
    expect(
      CategoryDocSchema.safeParse(aCategory({ parentId: CategoryIdSchema.parse('toys') })).success,
    ).toBe(true);
  });
});

describe('inventory', () => {
  it('rejects a total that disagrees with the per-warehouse map', () => {
    expectRejection(InventoryDocSchema, anInventoryRecord({ onHandTotal: 19 }), ['onHandTotal']);
  });

  it('rejects reserved units exceeding on-hand stock', () => {
    // This is the oversell invariant. It has to be unrepresentable, not merely
    // discouraged.
    expectRejection(InventoryDocSchema, anInventoryRecord({ reserved: 21 }), ['reserved']);
  });

  it('accepts a fully reserved record', () => {
    expect(InventoryDocSchema.safeParse(anInventoryRecord({ reserved: 20 })).success).toBe(true);
  });

  it('accepts an empty stock map with a zero total', () => {
    expect(
      InventoryDocSchema.safeParse(anInventoryRecord({ stock: {}, onHandTotal: 0, reserved: 0 }))
        .success,
    ).toBe(true);
  });

  it('accepts a negative ledger delta', () => {
    // Movements go both ways; balances never do.
    expect(InventoryLedgerDocSchema.safeParse(aLedgerEntry({ delta: -4 })).success).toBe(true);
  });

  it('rejects a reservation whose allocation does not sum to its quantity', () => {
    const item = aReservation().items[0];
    if (item === undefined) throw new Error('fixture has no reservation item');
    expectRejection(ReservationDocSchema, aReservation({ items: [{ ...item, qty: 3 }] }), [
      'items',
      0,
      'allocation',
    ]);
  });

  it('rejects an active reservation that claims to be resolved', () => {
    expectRejection(
      ReservationDocSchema,
      aReservation({ status: 'active', resolvedAt: FIXTURE_LATER }),
      ['resolvedAt'],
    );
  });

  it('rejects a released reservation with no resolution time', () => {
    expectRejection(ReservationDocSchema, aReservation({ status: 'released', resolvedAt: null }), [
      'resolvedAt',
    ]);
  });

  it('rejects a reservation that expires before it is created', () => {
    expectRejection(ReservationDocSchema, aReservation({ expiresAt: FIXTURE_NOW }), ['expiresAt']);
  });
});

describe('user', () => {
  it('rejects an email-primary account with no email', () => {
    expectRejection(UserDocSchema, aUser({ primaryIdentifierType: 'email', email: null }), [
      'primaryIdentifierType',
    ]);
  });

  it('accepts a mobile-only account', () => {
    // The whole point of ADR-0006: no email anywhere in the record.
    expect(
      UserDocSchema.safeParse(aUser({ primaryIdentifierType: 'phone', email: null })).success,
    ).toBe(true);
  });

  it('rejects a phone-primary account with no phone', () => {
    expectRejection(UserDocSchema, aUser({ primaryIdentifierType: 'phone', phone: null }), [
      'primaryIdentifierType',
    ]);
  });

  it('rejects lifetime value on an account with no orders', () => {
    expectRejection(UserDocSchema, aUser({ orderCount: 0 }), ['lifetimeValueMinor']);
  });

  it('rejects a deletion with no reason', () => {
    expectRejection(UserDocSchema, aUser({ deletedAt: FIXTURE_LATER }), ['deletionReason']);
  });

  it('accepts a redacted account', () => {
    expect(
      UserDocSchema.safeParse(
        aUser({ deletedAt: FIXTURE_LATER, deletionReason: 'Customer request' }),
      ).success,
    ).toBe(true);
  });

  it('normalises an email to lower case', () => {
    const parsed = UserDocSchema.parse({ ...aUser(), email: '  ASHA@Example.COM ' });
    expect(parsed.email).toBe('asha@example.com');
  });
});

describe('cart', () => {
  it('rejects a user cart with no uid', () => {
    expectRejection(CartDocSchema, aCart({ ownerType: 'user', userId: null }), ['userId']);
  });

  it('rejects an anonymous cart that carries a uid', () => {
    expectRejection(CartDocSchema, aCart({ ownerType: 'anonymous' }), ['userId']);
  });

  it('rejects an anonymous cart with no expiry', () => {
    expectRejection(
      CartDocSchema,
      aCart({ ownerType: 'anonymous', userId: null, expiresAt: null }),
      ['expiresAt'],
    );
  });

  it('accepts an anonymous cart that expires', () => {
    expect(
      CartDocSchema.safeParse(
        aCart({ ownerType: 'anonymous', userId: null, expiresAt: FIXTURE_LATER }),
      ).success,
    ).toBe(true);
  });

  it('rejects the same variant on two lines', () => {
    const line = aCart().items[0];
    if (line === undefined) throw new Error('fixture has no cart line');
    expectRejection(CartDocSchema, aCart({ items: [line, { ...line, qty: 1 }] }), ['items']);
  });

  it('accepts an empty cart', () => {
    expect(CartDocSchema.safeParse(aCart({ items: [] })).success).toBe(true);
  });
});

describe('order', () => {
  it('rejects a line total that is not price times quantity', () => {
    const line = anOrder().items[0];
    if (line === undefined) throw new Error('fixture has no order line');
    expectRejection(OrderDocSchema, anOrder({ items: [{ ...line, qty: 3 }] }), [
      'items',
      0,
      'lineTotalMinor',
    ]);
  });

  it('rejects a subtotal that disagrees with the lines', () => {
    // The components still add up to the total, so this isolates the line-sum
    // check rather than tripping the total check on the way past.
    const amounts = anOrder().amounts;
    expectRejection(
      OrderDocSchema,
      anOrder({
        amounts: {
          ...amounts,
          subtotalMinor: money(amounts.subtotalMinor - 1_000),
          totalMinor: money(amounts.totalMinor - 1_000),
        },
      }),
      ['amounts', 'subtotalMinor'],
    );
  });

  it('rejects a total that is not the sum of its components', () => {
    const amounts = anOrder().amounts;
    expectRejection(
      OrderDocSchema,
      anOrder({ amounts: { ...amounts, taxMinor: money(amounts.taxMinor + 1) } }),
      ['amounts', 'totalMinor'],
    );
  });

  it('rejects refunds exceeding the order total', () => {
    const amounts = anOrder().amounts;
    expectRejection(
      OrderDocSchema,
      anOrder({
        amounts: {
          ...amounts,
          refundedMinor: money(amounts.totalMinor + 1),
        },
      }),
      ['amounts', 'refundedMinor'],
    );
  });

  it('accepts a fully refunded order', () => {
    const amounts = anOrder().amounts;
    expect(
      OrderDocSchema.safeParse(
        anOrder({
          amounts: { ...amounts, refundedMinor: amounts.totalMinor },
          status: 'refunded',
          payment: {
            ...anOrder().payment,
            verifiedBy: anOrder().userId,
            verifiedAt: FIXTURE_LATER,
          },
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects a paid order with no verifying admin', () => {
    // "Who marked this paid" is the one question the manual-payment audit exists
    // to answer.
    expectRejection(OrderDocSchema, anOrder({ status: 'paid' }), ['payment', 'verifiedBy']);
  });

  it('rejects a refunded order with nothing refunded', () => {
    expectRejection(OrderDocSchema, anOrder({ status: 'refunded' }), ['amounts', 'refundedMinor']);
  });

  it('rejects a verification that records who but not when', () => {
    const payment = anOrder().payment;
    expectRejection(
      OrderDocSchema,
      anOrder({ payment: { ...payment, verifiedBy: anOrder().userId } }),
      ['payment', 'verifiedBy'],
    );
  });

  it('rejects a rejection with no reason', () => {
    const payment = anOrder().payment;
    expectRejection(
      OrderDocSchema,
      anOrder({
        payment: {
          ...payment,
          rejectedBy: anOrder().userId,
          rejectedAt: FIXTURE_LATER,
          rejectionReason: null,
        },
      }),
      ['payment', 'rejectionReason'],
    );
  });

  it('rejects a submitted reference with no submission time', () => {
    const payment = anOrder().payment;
    expectRejection(
      OrderDocSchema,
      anOrder({ payment: { ...payment, upiRef: aPaymentRefGuard().upiRef } }),
      ['payment', 'submittedAt'],
    );
  });

  it('rejects a shipped order with no tracking number', () => {
    const fulfilment = anOrder().fulfilment;
    expectRejection(
      OrderDocSchema,
      anOrder({ fulfilment: { ...fulfilment, status: 'shipped', shippedAt: FIXTURE_LATER } }),
      ['fulfilment', 'trackingNo'],
    );
  });

  it('rejects an on-hold order with no reason', () => {
    const fulfilment = anOrder().fulfilment;
    expectRejection(OrderDocSchema, anOrder({ fulfilment: { ...fulfilment, status: 'on_hold' } }), [
      'fulfilment',
      'holdReason',
    ]);
  });

  it('rejects an allocation that does not match what was ordered', () => {
    expectRejection(OrderDocSchema, anOrder({ allocation: {} }), ['allocation']);
  });

  it('rejects an allocation whose quantities are short', () => {
    const [variantId] = Object.keys(anOrder().allocation);
    if (variantId === undefined) throw new Error('fixture has no allocation');
    expectRejection(OrderDocSchema, anOrder({ allocation: { [variantId]: { [BLR]: 1 } } }), [
      'allocation',
    ]);
  });

  it('accepts an allocation split across two warehouses', () => {
    const [variantId] = Object.keys(anOrder().allocation);
    if (variantId === undefined) throw new Error('fixture has no allocation');
    expect(
      OrderDocSchema.safeParse(anOrder({ allocation: { [variantId]: { [BLR]: 1, [DEL]: 1 } } }))
        .success,
    ).toBe(true);
  });
});

describe('notification', () => {
  it('rejects a customer notification with no addressee', () => {
    expectRejection(NotificationDocSchema, aNotification({ userId: null }), ['userId']);
  });

  it('rejects a staff notification addressed to one uid', () => {
    expectRejection(
      NotificationDocSchema,
      anAdminNotification({ userId: aNotification().userId }),
      ['userId'],
    );
  });

  it('rejects a staff notification using the single-reader field', () => {
    // A shared `readAt` would let the first admin to open the bell mark an order
    // read for the entire team.
    expectRejection(NotificationDocSchema, anAdminNotification({ readAt: FIXTURE_LATER }), [
      'readAt',
    ]);
  });

  it('rejects a customer notification using the per-admin field', () => {
    expectRejection(
      NotificationDocSchema,
      aNotification({ readBy: { [STAFF_UID]: FIXTURE_LATER } }),
      ['readBy'],
    );
  });

  it('accepts per-admin read state on a staff notification', () => {
    expect(
      NotificationDocSchema.safeParse(
        anAdminNotification({ readBy: { [STAFF_UID]: FIXTURE_LATER } }),
      ).success,
    ).toBe(true);
  });

  it('rejects a notification that expires before it is created', () => {
    expectRejection(NotificationDocSchema, aNotification({ expiresAt: FIXTURE_NOW }), [
      'expiresAt',
    ]);
  });

  it('derives a stable, recipient-scoped document ID', () => {
    // Deterministic IDs are what make a dispatcher replay an overwrite rather than
    // a duplicate (ADR-0007).
    expect(notificationId('event-1', 'user', 'uid-1')).toBe(
      notificationId('event-1', 'user', 'uid-1'),
    );
    expect(notificationId('event-1', 'user', 'uid-1')).not.toBe(
      notificationId('event-1', 'user', 'uid-2'),
    );
    expect(notificationId('event-1', 'admin', null)).toBe('event-1_admin_all');
  });
});

describe('review', () => {
  it('rejects a verified-purchase badge with no order behind it', () => {
    expectRejection(ReviewDocSchema, aReview({ orderId: null }), ['orderId']);
  });

  it('rejects an unverified review that still names an order', () => {
    expectRejection(ReviewDocSchema, aReview({ verifiedPurchase: false }), ['orderId']);
  });

  it('rejects a published review with no moderator', () => {
    expectRejection(ReviewDocSchema, aReview({ moderatedBy: null, moderatedAt: null }), [
      'moderatedBy',
    ]);
  });

  it('accepts a pending review with no moderator', () => {
    expect(
      ReviewDocSchema.safeParse(
        aReview({ status: 'pending', moderatedBy: null, moderatedAt: null }),
      ).success,
    ).toBe(true);
  });

  it('rejects a pending review carrying a rejection reason', () => {
    expectRejection(
      ReviewDocSchema,
      aReview({
        status: 'pending',
        moderatedBy: null,
        moderatedAt: null,
        rejectionReason: 'Off topic',
      }),
      ['rejectionReason'],
    );
  });

  it('rejects a moderation that records who but not when', () => {
    expectRejection(ReviewDocSchema, aReview({ moderatedAt: null }), ['moderatedBy']);
  });
});

describe('refund', () => {
  it('rejects a zero refund', () => {
    expectRejection(RefundDocSchema, aRefund({ amountMinor: money(0) }), ['amountMinor']);
  });

  it('rejects a reason that needs a note without one', () => {
    expectRejection(RefundDocSchema, aRefund({ reason: 'other', note: null }), ['note']);
  });

  it('accepts an adjustment with a note', () => {
    expect(
      RefundDocSchema.safeParse(
        aRefund({ reason: 'adjustment', note: 'Corrects RF-1 which was 100 short.' }),
      ).success,
    ).toBe(true);
  });

  it('accepts a refund recorded before the transfer has gone out', () => {
    expect(RefundDocSchema.safeParse(aRefund({ outwardUpiRef: null })).success).toBe(true);
  });
});

describe('settings and analytics', () => {
  it('rejects a free-shipping threshold with no shipping charge below it', () => {
    expectRejection(
      CheckoutSettingsDocSchema,
      checkoutSettings({ standardShippingFeeMinor: money(0) }),
      ['standardShippingFeeMinor'],
    );
  });

  it('accepts a store that never charges shipping', () => {
    expect(
      CheckoutSettingsDocSchema.safeParse(
        checkoutSettings({
          freeShippingThresholdMinor: money(0),
          standardShippingFeeMinor: money(0),
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects paid orders outnumbering orders placed', () => {
    expectRejection(DailyAnalyticsDocSchema, dailyAnalytics({ orderCount: 1 }), ['paidCount']);
  });

  it('rejects an average order value with no paid orders', () => {
    expectRejection(DailyAnalyticsDocSchema, dailyAnalytics({ paidCount: 0 }), ['aovMinor']);
  });

  it('accepts a day with no sales', () => {
    expect(
      DailyAnalyticsDocSchema.safeParse(
        dailyAnalytics({
          orderCount: 0,
          paidCount: 0,
          rejectedCount: 0,
          revenueMinor: money(0),
          aovMinor: money(0),
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects a malformed rollup date', () => {
    expectRejection(DailyAnalyticsDocSchema, dailyAnalytics({ date: '01-03-2026' }), ['date']);
  });
});

describe('the event spine', () => {
  it('accepts an event whose payload matches its type', () => {
    const result = EventDocSchema.safeParse({
      type: 'order.created',
      actorId: 'system',
      subject: { kind: 'order', id: 'order-0001' },
      payload: {
        type: 'order.created',
        orderId: 'order-0001',
        humanId: 'RMP-24817',
        userId: 'customer-uid-0001',
        totalMinor: 290_976,
        itemCount: 1,
      },
      at: FIXTURE_NOW,
    });
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it('rejects an order.shipped event with no tracking number', () => {
    // The notification copy interpolates it. Failing where the event is written
    // beats rendering "shipped with undefined".
    const result = EventDocSchema.safeParse({
      type: 'order.shipped',
      actorId: 'staff-uid-0001',
      subject: { kind: 'order', id: 'order-0001' },
      payload: {
        type: 'order.shipped',
        orderId: 'order-0001',
        humanId: 'RMP-24817',
        userId: 'customer-uid-0001',
        carrier: 'Delhivery',
      },
      at: FIXTURE_NOW,
    });
    expect(result.success).toBe(false);
  });
});
