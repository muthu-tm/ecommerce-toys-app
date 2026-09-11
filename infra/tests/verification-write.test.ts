import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderDoc, ReservationDoc } from '@romp/contracts';
import { anInventoryRecord, anOrder, aReservation } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  asOperator,
  converters,
  createStoreContext,
  findOrder,
  rejectPayment,
  systemClock,
  verifyPayment,
} from '@romp/data';
import { PaymentAmountMismatchError } from '@romp/observability';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * Payment verification against real Firestore.
 *
 * `@romp/data` unit-tests the orchestration; this proves the commit end to end: an exact-amount
 * verify decrements on-hand and reserved together, writes an `order_committed` ledger entry,
 * resolves the reservation to `committed`, and marks the order paid — and a reject leaves the stock
 * reserved for a resubmission.
 */

let app: App;
let ctx: StoreContext;
const STAFF = asOperator('staff-uid-0001', 'staff');
const TOTAL = 2_90_976;

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `verify-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Seeds a pending_verification order, its active reservation and inventory holding 2 units. */
async function seedPending(): Promise<{
  orderId: string;
  reservationId: string;
  variantId: string;
}> {
  const orderId = uniqueId('order');
  const reservationId = uniqueId('res');
  const variantId = uniqueId('v');

  await ctx.db
    .doc(`orders/${orderId}`)
    .withConverter(converters.orders)
    .set(
      anOrder({
        status: 'pending_verification',
        reservationId: reservationId as OrderDoc['reservationId'],
        items: [
          {
            ...anOrder().items[0]!,
            variantId: variantId as OrderDoc['items'][number]['variantId'],
          },
        ],
        allocation: { [variantId]: { blr: 2 } } as unknown as OrderDoc['allocation'],
        payment: {
          ...anOrder().payment,
          upiRef: '412398765432' as OrderDoc['payment']['upiRef'],
          submittedAt: new Date(),
        },
      }),
    );
  await ctx.db
    .doc(`reservations/${reservationId}`)
    .withConverter(converters.reservations)
    .set(
      aReservation({
        orderId: orderId as ReservationDoc['orderId'],
        status: 'active',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        resolvedAt: null,
        items: [{ variantId: variantId as never, qty: 2, allocation: { blr: 2 } as never }],
      }),
    );
  await ctx.db
    .doc(`inventory/${variantId}`)
    .withConverter(converters.inventory)
    .set(
      anInventoryRecord({
        stock: { blr: 10 } as ReturnType<typeof anInventoryRecord>['stock'],
        onHandTotal: 10,
        reserved: 2,
      }),
    );
  return { orderId, reservationId, variantId };
}

describe('verifyPayment against Firestore', () => {
  it('commits stock, resolves the reservation, and marks the order paid', async () => {
    const { orderId, reservationId, variantId } = await seedPending();

    const result = await verifyPayment(ctx, STAFF, { orderId, paidAmountMinor: TOTAL });
    expect(result.status).toBe('paid');

    const order = await findOrder(ctx, STAFF, orderId);
    expect(order.status).toBe('paid');
    expect(order.payment.verifiedBy).toBe('staff-uid-0001');

    // On-hand and reserved fell together: 10 -> 8, reserved 2 -> 0.
    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.onHandTotal).toBe(8);
    expect(inventory?.reserved).toBe(0);

    // The reservation is committed.
    const reservation = (
      await ctx.db.doc(`reservations/${reservationId}`).withConverter(converters.reservations).get()
    ).data();
    expect(reservation?.status).toBe('committed');

    // An order_committed ledger entry with a negative delta exists for this order.
    const ledger = await ctx.db
      .collection('inventoryLedger')
      .where('refId', '==', orderId)
      .where('reason', '==', 'order_committed')
      .get();
    expect(ledger.empty).toBe(false);
    expect(ledger.docs[0]?.data().delta).toBe(-2);

    // An order.payment_verified event was appended to the spine.
    const events = await ctx.db
      .collection('events')
      .where('subject.id', '==', orderId)
      .where('type', '==', 'order.payment_verified')
      .get();
    expect(events.empty).toBe(false);
  });

  it('refuses a short payment and leaves the order pending', async () => {
    const { orderId, variantId } = await seedPending();
    await expect(
      verifyPayment(ctx, STAFF, { orderId, paidAmountMinor: TOTAL - 100 }),
    ).rejects.toBeInstanceOf(PaymentAmountMismatchError);

    const order = await findOrder(ctx, STAFF, orderId);
    expect(order.status).toBe('pending_verification');
    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.reserved).toBe(2);
    expect(inventory?.onHandTotal).toBe(10);
  });
});

describe('rejectPayment against Firestore', () => {
  it('rejects the order and leaves the stock reserved', async () => {
    const { orderId, reservationId, variantId } = await seedPending();

    const result = await rejectPayment(ctx, STAFF, { orderId, reason: 'Reference did not match.' });
    expect(result.status).toBe('payment_rejected');

    const order = await findOrder(ctx, STAFF, orderId);
    expect(order.status).toBe('payment_rejected');
    expect(order.payment.rejectionReason).toBe('Reference did not match.');

    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.reserved).toBe(2);
    const reservation = (
      await ctx.db.doc(`reservations/${reservationId}`).withConverter(converters.reservations).get()
    ).data();
    expect(reservation?.status).toBe('active');
  });
});
