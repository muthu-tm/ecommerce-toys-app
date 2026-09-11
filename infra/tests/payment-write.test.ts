import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderDoc, ReservationDoc } from '@romp/contracts';
import { anOrder, aReservation } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  asCustomer,
  converters,
  createStoreContext,
  findOrder,
  submitPaymentProof,
  systemClock,
} from '@romp/data';
import { DuplicatePaymentReferenceError } from '@romp/observability';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * Payment-proof submission against real Firestore.
 *
 * `@romp/data` unit-tests the orchestration; this proves the property a fake cannot: that two
 * submissions racing to claim the SAME UTR — whether for one order or two — serialise on the
 * `paymentRefGuards/{utr}` document, so exactly one succeeds and exactly one guard document exists.
 * It also proves the whole submission commits together end to end.
 */

let app: App;
let ctx: StoreContext;

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `payment-write-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Seeds an owned order (awaiting_payment) and its active, unexpired reservation. */
async function seedOrder(uid: string): Promise<string> {
  const orderId = uniqueId('order');
  const reservationId = uniqueId('res');
  const now = new Date();
  await ctx.db
    .doc(`orders/${orderId}`)
    .withConverter(converters.orders)
    .set(
      anOrder({
        userId: uid as OrderDoc['userId'],
        status: 'awaiting_payment',
        reservationId: reservationId as OrderDoc['reservationId'],
      }),
    );
  await ctx.db
    .doc(`reservations/${reservationId}`)
    .withConverter(converters.reservations)
    .set(
      aReservation({
        orderId: orderId as ReservationDoc['orderId'],
        status: 'active',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        resolvedAt: null,
      }),
    );
  return orderId;
}

describe('submitPaymentProof against Firestore', () => {
  it('stamps the order, claims the UTR, and moves it into verification', async () => {
    const uid = uniqueId('u');
    const orderId = await seedOrder(uid);
    const utr = uniqueId('UTR').replaceAll('-', '').toUpperCase().slice(0, 20);

    const result = await submitPaymentProof(ctx, asCustomer(uid), {
      orderId,
      upiRef: utr,
      screenshotPath: null,
    });
    expect(result.status).toBe('pending_verification');

    const order = await findOrder(ctx, asCustomer(uid), orderId);
    expect(order.status).toBe('pending_verification');
    expect(order.payment.upiRef).toBe(utr);
    expect(order.payment.submittedAt).not.toBeNull();

    // The guard document exists at the normalised UTR.
    const guard = await ctx.db.doc(`paymentRefGuards/${utr}`).get();
    expect(guard.exists).toBe(true);
  });

  it('serialises two submissions of the same UTR — exactly one succeeds, one guard exists', async () => {
    const uidA = uniqueId('u');
    const uidB = uniqueId('u');
    const orderA = await seedOrder(uidA);
    const orderB = await seedOrder(uidB);
    const utr = uniqueId('UTR').replaceAll('-', '').toUpperCase().slice(0, 20);

    const results = await Promise.allSettled([
      submitPaymentProof(ctx, asCustomer(uidA), {
        orderId: orderA,
        upiRef: utr,
        screenshotPath: null,
      }),
      submitPaymentProof(ctx, asCustomer(uidB), {
        orderId: orderB,
        upiRef: utr,
        screenshotPath: null,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(DuplicatePaymentReferenceError);

    // Exactly one guard document for the UTR.
    const guard = await ctx.db.doc(`paymentRefGuards/${utr}`).get();
    expect(guard.exists).toBe(true);
  });

  it('refuses a UTR already claimed by another order', async () => {
    const uidA = uniqueId('u');
    const uidB = uniqueId('u');
    const orderA = await seedOrder(uidA);
    const orderB = await seedOrder(uidB);
    const utr = uniqueId('UTR').replaceAll('-', '').toUpperCase().slice(0, 20);

    await submitPaymentProof(ctx, asCustomer(uidA), {
      orderId: orderA,
      upiRef: utr,
      screenshotPath: null,
    });
    await expect(
      submitPaymentProof(ctx, asCustomer(uidB), {
        orderId: orderB,
        upiRef: utr,
        screenshotPath: null,
      }),
    ).rejects.toBeInstanceOf(DuplicatePaymentReferenceError);
  });
});
