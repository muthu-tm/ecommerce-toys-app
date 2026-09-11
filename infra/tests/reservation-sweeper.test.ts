import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderDoc, ReservationDoc } from '@romp/contracts';
import { anInventoryRecord, anOrder, aReservation } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import { converters, createStoreContext, sweepExpiredReservations, systemClock } from '@romp/data';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The reservation sweeper against real Firestore.
 *
 * `@romp/data` unit-tests the orchestration; this proves it end to end against the same
 * `status == 'active' && expiresAt <= now` query the scheduled Function runs: a past-expiry
 * reservation is released — its order expired, its held `reserved` returned to available, the
 * reservation itself resolved — and a second pass is a no-op, which is the whole reason the sweep is
 * safe to run on a schedule.
 */

let app: App;
let ctx: StoreContext;

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `sweeper-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Seeds an awaiting_payment order, an active reservation expired in the past, and inventory. */
async function seedExpired(
  reserved = 2,
): Promise<{ orderId: string; reservationId: string; variantId: string }> {
  const orderId = uniqueId('order');
  const reservationId = uniqueId('res');
  const variantId = uniqueId('v');
  const now = Date.now();

  await ctx.db
    .doc(`orders/${orderId}`)
    .withConverter(converters.orders)
    .set(
      anOrder({
        status: 'awaiting_payment',
        reservationId: reservationId as OrderDoc['reservationId'],
        items: [
          {
            ...anOrder().items[0]!,
            variantId: variantId as OrderDoc['items'][number]['variantId'],
          },
        ],
        allocation: {
          [variantId]: { blr: 2 },
        } as unknown as OrderDoc['allocation'],
      }),
    );
  await ctx.db
    .doc(`reservations/${reservationId}`)
    .withConverter(converters.reservations)
    .set(
      aReservation({
        orderId: orderId as ReservationDoc['orderId'],
        status: 'active',
        createdAt: new Date(now - 60 * 60 * 1000),
        expiresAt: new Date(now - 60 * 1000),
        resolvedAt: null,
        items: [
          {
            variantId: variantId as never,
            qty: 2,
            allocation: { blr: 2 } as never,
          },
        ],
      }),
    );
  await ctx.db
    .doc(`inventory/${variantId}`)
    .withConverter(converters.inventory)
    .set(
      anInventoryRecord({
        stock: { blr: 10 } as ReturnType<typeof anInventoryRecord>['stock'],
        onHandTotal: 10,
        reserved,
      }),
    );
  return { orderId, reservationId, variantId };
}

describe('sweepExpiredReservations against Firestore', () => {
  it('releases an expired reservation: order expired, reserved returned, reservation resolved', async () => {
    const { orderId, reservationId, variantId } = await seedExpired(2);

    const result = await sweepExpiredReservations(ctx);
    expect(result.released).toBeGreaterThanOrEqual(1);

    const order = (
      await ctx.db.doc(`orders/${orderId}`).withConverter(converters.orders).get()
    ).data();
    expect(order?.status).toBe('expired');

    const reservation = (
      await ctx.db.doc(`reservations/${reservationId}`).withConverter(converters.reservations).get()
    ).data();
    expect(reservation?.status).toBe('released');
    expect(reservation?.resolvedAt).not.toBeNull();

    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    // On-hand unchanged; the hold is returned to available (reserved 2 -> 0).
    expect(inventory?.onHandTotal).toBe(10);
    expect(inventory?.reserved).toBe(0);

    // An order.expired event was appended to the spine.
    const events = await ctx.db
      .collection('events')
      .where('subject.id', '==', orderId)
      .where('type', '==', 'order.expired')
      .get();
    expect(events.empty).toBe(false);
  });

  it('is idempotent — a second pass does not touch the already-released reservation', async () => {
    const { orderId, variantId } = await seedExpired(2);
    await sweepExpiredReservations(ctx);
    // Capture state after the first sweep.
    const afterFirst = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();

    await sweepExpiredReservations(ctx);
    const afterSecond = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(afterSecond?.reserved).toBe(afterFirst?.reserved);
    expect(afterSecond?.reserved).toBe(0);

    const order = (
      await ctx.db.doc(`orders/${orderId}`).withConverter(converters.orders).get()
    ).data();
    expect(order?.status).toBe('expired');
  });
});
