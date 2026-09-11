import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FulfilmentStatus, OrderDoc } from '@romp/contracts';
import { anOrder } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  advanceFulfilment,
  asOperator,
  converters,
  createStoreContext,
  findOrder,
  systemClock,
} from '@romp/data';
import { InvalidStateTransitionError } from '@romp/observability';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * Fulfilment advancement against real Firestore.
 *
 * `@romp/data` unit-tests the orchestration; this proves the sequence end to end against the
 * converters and the fulfilment machine: a paid order packs, ships with a carrier and tracking, and
 * delivers, appending the spine events the dispatcher projects — and an unpaid order cannot be
 * packed.
 */

let app: App;
let ctx: StoreContext;
const STAFF = asOperator('staff-uid-0001', 'staff');

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `fulfil-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Seeds one order at a given payment and fulfilment status. */
async function seedOrder(options: {
  status?: OrderDoc['status'];
  fulfilmentStatus?: FulfilmentStatus;
  fulfilment?: Partial<OrderDoc['fulfilment']>;
}): Promise<string> {
  const orderId = uniqueId('order');
  const status = options.status ?? 'paid';
  const paid = status === 'paid';
  await ctx.db
    .doc(`orders/${orderId}`)
    .withConverter(converters.orders)
    .set(
      anOrder({
        status,
        fulfilment: {
          ...anOrder().fulfilment,
          status: options.fulfilmentStatus ?? 'unfulfilled',
          ...options.fulfilment,
        },
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
  return orderId;
}

describe('advanceFulfilment against Firestore', () => {
  it('packs, ships and delivers a paid order, appending the spine events', async () => {
    const orderId = await seedOrder({ status: 'paid', fulfilmentStatus: 'unfulfilled' });

    await advanceFulfilment(ctx, STAFF, { orderId, status: 'packed' });
    let order = await findOrder(ctx, STAFF, orderId);
    expect(order.fulfilment.status).toBe('packed');
    expect(order.fulfilment.packedAt).not.toBeNull();

    await advanceFulfilment(ctx, STAFF, {
      orderId,
      status: 'shipped',
      carrier: 'Delhivery',
      trackingNo: 'DL123456',
    });
    order = await findOrder(ctx, STAFF, orderId);
    expect(order.fulfilment.status).toBe('shipped');
    expect(order.fulfilment.carrier).toBe('Delhivery');
    expect(order.fulfilment.trackingNo).toBe('DL123456');
    // packedAt survives the ship advance.
    expect(order.fulfilment.packedAt).not.toBeNull();

    await advanceFulfilment(ctx, STAFF, { orderId, status: 'delivered' });
    order = await findOrder(ctx, STAFF, orderId);
    expect(order.fulfilment.status).toBe('delivered');
    expect(order.fulfilment.deliveredAt).not.toBeNull();

    // The three customer-visible stages each appended a spine event.
    for (const type of ['order.packed', 'order.shipped', 'order.delivered']) {
      const events = await ctx.db
        .collection('events')
        .where('subject.id', '==', orderId)
        .where('type', '==', type)
        .get();
      expect(events.empty).toBe(false);
    }
  });

  it('refuses to pack an order that is not paid', async () => {
    const orderId = await seedOrder({
      status: 'pending_verification',
      fulfilmentStatus: 'unfulfilled',
    });
    await expect(
      advanceFulfilment(ctx, STAFF, { orderId, status: 'packed' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    const order = await findOrder(ctx, STAFF, orderId);
    expect(order.fulfilment.status).toBe('unfulfilled');
  });

  it('places a paid order on hold with a reason, announcing nothing', async () => {
    const orderId = await seedOrder({ status: 'paid', fulfilmentStatus: 'unfulfilled' });
    await advanceFulfilment(ctx, STAFF, {
      orderId,
      status: 'on_hold',
      holdReason: 'Awaiting stock.',
    });
    const order = await findOrder(ctx, STAFF, orderId);
    expect(order.fulfilment.status).toBe('on_hold');
    expect(order.fulfilment.holdReason).toBe('Awaiting stock.');

    // No customer notification is projected for a hold.
    const events = await ctx.db.collection('events').where('subject.id', '==', orderId).get();
    expect(events.empty).toBe(true);
  });
});
