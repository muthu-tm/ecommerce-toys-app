import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderDoc } from '@romp/contracts';
import { anInventoryRecord, anOrder } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  asOperator,
  converters,
  createStoreContext,
  findOrder,
  issueRefund,
  systemClock,
} from '@romp/data';
import { NotFoundError, RefundExceedsRefundableError } from '@romp/observability';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * Refunds against real Firestore.
 *
 * `@romp/data` unit-tests the orchestration; this proves it end to end: a full refund moves the
 * order to `refunded` and, when restocking, returns units to on-hand through a `refund_restock`
 * ledger entry; a partial refund leaves the order paid; the cap and the owner claim are enforced.
 */

let app: App;
let ctx: StoreContext;
const OWNER = asOperator('owner-uid-0001', 'owner');
const STAFF = asOperator('staff-uid-0001', 'staff');
const TOTAL = 2_90_976;

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `refund-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Seeds a paid order and its inventory (on-hand already decremented by the commit). */
async function seedPaid(): Promise<{ orderId: string; variantId: string }> {
  const orderId = uniqueId('order');
  const variantId = uniqueId('v');
  await ctx.db
    .doc(`orders/${orderId}`)
    .withConverter(converters.orders)
    .set(
      anOrder({
        status: 'paid',
        reservationId: null,
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
          verifiedBy: 'staff-uid-0001' as OrderDoc['payment']['verifiedBy'],
          verifiedAt: new Date(),
        },
      }),
    );
  await ctx.db
    .doc(`inventory/${variantId}`)
    .withConverter(converters.inventory)
    .set(
      anInventoryRecord({
        stock: { blr: 8 } as ReturnType<typeof anInventoryRecord>['stock'],
        onHandTotal: 8,
        reserved: 0,
      }),
    );
  return { orderId, variantId };
}

const refundOf = (orderId: string, over: Partial<Parameters<typeof issueRefund>[2]> = {}) => ({
  orderId,
  mode: 'full' as const,
  amountMinor: TOTAL,
  reason: 'customer_cancelled' as const,
  note: null,
  outwardUpiRef: null,
  restock: false,
  ...over,
});

describe('issueRefund against Firestore', () => {
  it('records a full refund with restock and returns the order to refunded', async () => {
    const { orderId, variantId } = await seedPaid();

    const result = await issueRefund(ctx, OWNER, refundOf(orderId, { restock: true }));
    expect(result.status).toBe('refunded');
    expect(result.refundedMinor).toBe(TOTAL);

    const order = await findOrder(ctx, OWNER, orderId);
    expect(order.status).toBe('refunded');
    expect(order.amounts.refundedMinor).toBe(TOTAL);

    // On-hand rose by the restocked 2 (8 -> 10).
    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.onHandTotal).toBe(10);

    // A refund_restock ledger entry exists.
    const ledger = await ctx.db
      .collection('inventoryLedger')
      .where('reason', '==', 'refund_restock')
      .where('variantId', '==', variantId)
      .get();
    expect(ledger.empty).toBe(false);
    expect(ledger.docs[0]?.data().delta).toBe(2);

    // A refund.issued event was appended to the spine.
    const events = await ctx.db
      .collection('events')
      .where('type', '==', 'refund.issued')
      .where('payload.orderId', '==', orderId)
      .get();
    expect(events.empty).toBe(false);
  });

  it('records a partial refund and leaves the order paid', async () => {
    const { orderId } = await seedPaid();
    const result = await issueRefund(
      ctx,
      OWNER,
      refundOf(orderId, { mode: 'partial', amountMinor: 1_00_000 }),
    );
    expect(result.status).toBe('paid');
    expect(result.refundedMinor).toBe(1_00_000);
    expect((await findOrder(ctx, OWNER, orderId)).status).toBe('paid');
  });

  it('refuses a refund beyond the refundable amount', async () => {
    const { orderId } = await seedPaid();
    await issueRefund(ctx, OWNER, refundOf(orderId, { mode: 'partial', amountMinor: 2_00_000 }));
    await expect(
      issueRefund(ctx, OWNER, refundOf(orderId, { mode: 'partial', amountMinor: 1_50_000 })),
    ).rejects.toBeInstanceOf(RefundExceedsRefundableError);
  });

  it('refuses a staff caller — refunds require the owner claim', async () => {
    const { orderId } = await seedPaid();
    await expect(issueRefund(ctx, STAFF, refundOf(orderId))).rejects.toBeInstanceOf(NotFoundError);
  });
});
