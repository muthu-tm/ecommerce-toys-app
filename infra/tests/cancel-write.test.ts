import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderDoc, ReservationDoc } from '@romp/contracts';
import { anInventoryRecord, anOrder, aReservation } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  asOperator,
  cancelOrder,
  converters,
  createStoreContext,
  findOrder,
  systemClock,
} from '@romp/data';
import { InvalidStateTransitionError } from '@romp/observability';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * Order cancellation against real Firestore.
 *
 * `@romp/data` unit-tests the branch logic; this proves both undos end to end: a pre-payment cancel
 * releases the reservation and lowers `reserved` without a ledger entry; a paid cancel with restock
 * raises on-hand and writes an `order_cancelled` ledger entry — and a shipped order cannot be
 * cancelled.
 */

let app: App;
let ctx: StoreContext;
const STAFF = asOperator('staff-uid-0001', 'staff');

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `cancel-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Seeds an order at a status, plus its reservation and inventory. */
async function seedOrder(options: {
  status: OrderDoc['status'];
  fulfilmentStatus?: OrderDoc['fulfilment']['status'];
  onHand?: number;
  reserved?: number;
}): Promise<{ orderId: string; reservationId: string; variantId: string }> {
  const orderId = uniqueId('order');
  const reservationId = uniqueId('res');
  const variantId = uniqueId('v');
  const paid = options.status === 'paid';

  await ctx.db
    .doc(`orders/${orderId}`)
    .withConverter(converters.orders)
    .set(
      anOrder({
        status: options.status,
        fulfilment: {
          ...anOrder().fulfilment,
          status: options.fulfilmentStatus ?? 'unfulfilled',
          ...(options.fulfilmentStatus === 'shipped'
            ? {
                packedAt: new Date(),
                shippedAt: new Date(),
                carrier: 'Delhivery',
                trackingNo: 'DL1',
              }
            : {}),
        },
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
          ...(paid
            ? {
                upiRef: '412398765432' as OrderDoc['payment']['upiRef'],
                submittedAt: new Date(),
                verifiedBy: 'staff-uid-0001' as OrderDoc['payment']['verifiedBy'],
                verifiedAt: new Date(),
              }
            : {}),
        },
      }),
    );
  await ctx.db
    .doc(`reservations/${reservationId}`)
    .withConverter(converters.reservations)
    .set(
      aReservation({
        orderId: orderId as ReservationDoc['orderId'],
        status: paid ? 'committed' : 'active',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        resolvedAt: paid ? new Date() : null,
        items: [{ variantId: variantId as never, qty: 2, allocation: { blr: 2 } as never }],
      }),
    );
  await ctx.db
    .doc(`inventory/${variantId}`)
    .withConverter(converters.inventory)
    .set(
      anInventoryRecord({
        stock: { blr: options.onHand ?? (paid ? 8 : 10) } as ReturnType<
          typeof anInventoryRecord
        >['stock'],
        onHandTotal: options.onHand ?? (paid ? 8 : 10),
        reserved: options.reserved ?? (paid ? 0 : 2),
      }),
    );
  return { orderId, reservationId, variantId };
}

describe('cancelOrder against Firestore', () => {
  it('releases a held reservation and lowers reserved, with no ledger entry', async () => {
    const { orderId, reservationId, variantId } = await seedOrder({ status: 'awaiting_payment' });

    const result = await cancelOrder(ctx, STAFF, {
      orderId,
      reason: 'Changed mind.',
      restock: false,
    });
    expect(result.status).toBe('cancelled');

    const order = await findOrder(ctx, STAFF, orderId);
    expect(order.status).toBe('cancelled');
    expect(order.fulfilment.status).toBe('cancelled');

    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.reserved).toBe(0);
    expect(inventory?.onHandTotal).toBe(10);

    const reservation = (
      await ctx.db.doc(`reservations/${reservationId}`).withConverter(converters.reservations).get()
    ).data();
    expect(reservation?.status).toBe('released');

    // No inventory-ledger entry for a held-stock release.
    const ledger = await ctx.db.collection('inventoryLedger').where('refId', '==', orderId).get();
    expect(ledger.empty).toBe(true);

    // A cancellation event reached the spine.
    const events = await ctx.db
      .collection('events')
      .where('subject.id', '==', orderId)
      .where('type', '==', 'order.cancelled')
      .get();
    expect(events.empty).toBe(false);
  });

  it('restocks a paid order and writes an order_cancelled ledger entry', async () => {
    const { orderId, variantId } = await seedOrder({ status: 'paid', onHand: 8, reserved: 0 });

    await cancelOrder(ctx, STAFF, { orderId, reason: 'Damaged.', restock: true });

    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    // On-hand rises back: 8 -> 10.
    expect(inventory?.onHandTotal).toBe(10);

    const ledger = await ctx.db
      .collection('inventoryLedger')
      .where('refId', '==', orderId)
      .where('reason', '==', 'order_cancelled')
      .get();
    expect(ledger.empty).toBe(false);
    expect(ledger.docs[0]?.data().delta).toBe(2);
  });

  it('refuses to cancel a shipped order', async () => {
    const { orderId } = await seedOrder({
      status: 'paid',
      fulfilmentStatus: 'shipped',
      onHand: 8,
      reserved: 0,
    });
    await expect(
      cancelOrder(ctx, STAFF, { orderId, reason: 'x', restock: true }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});
