import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderDoc } from '@romp/contracts';
import { anOrder } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import { asOperator, converters, createStoreContext, listOrders, systemClock } from '@romp/data';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The admin order list against real Firestore.
 *
 * `@romp/data` unit-tests the clause shapes and the cursor; this proves the paging and filtering
 * end to end against real indexes: a page walks newest-first, the cursor picks up where it left off
 * with no gaps or repeats, a status filter narrows the set, and a humanId search returns the one
 * order.
 */

let app: App;
let ctx: StoreContext;
const STAFF = asOperator('staff-uid-0001', 'staff');

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `orderlist-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const run = String(Date.now());
const orderId = (n: number): string => `list-${run}-order-${String(n).padStart(2, '0')}`;

/** Seeds N orders with strictly increasing createdAt and a shared, unique humanId prefix. */
async function seedOrders(
  count: number,
  status: OrderDoc['status'] = 'awaiting_payment',
): Promise<void> {
  const base = new Date('2099-01-01T00:00:00.000Z').getTime();
  const paid = status === 'paid';
  for (let i = 0; i < count; i += 1) {
    await ctx.db
      .doc(`orders/${orderId(i)}`)
      .withConverter(converters.orders)
      .set(
        anOrder({
          humanId: `RMP-${run.slice(-5)}${String(i)}` as OrderDoc['humanId'],
          status,
          // Far-future timestamps so this run's orders are the newest in the shared emulator database
          // and the paginated walk reaches them within its page budget, regardless of other files'
          // seeded orders.
          createdAt: new Date(base + i * 60_000),
          updatedAt: new Date(base + i * 60_000),
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
  }
}

/** Only this run's seeded orders, so a shared emulator database does not pollute assertions. */
function mine(items: readonly { id: string }[]): string[] {
  return items.map((item) => item.id).filter((id) => id.startsWith(`list-${run}-`));
}

describe('listOrders against Firestore', () => {
  it('walks pages newest-first with a cursor, no gaps or repeats', async () => {
    await seedOrders(5);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listOrders(ctx, STAFF, { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...mine(page.items));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    // All five seen exactly once, newest (order-04) first.
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen[0]).toBe(orderId(4));
    expect(seen.at(-1)).toBe(orderId(0));
  });

  it('narrows to a payment status', async () => {
    await seedOrders(2, 'paid');
    const page = await listOrders(ctx, STAFF, { status: 'paid', limit: 100 });
    // Every returned order (from this run or otherwise) is paid.
    expect(page.items.every((order) => order.status === 'paid')).toBe(true);
    // This run's paid orders are present.
    expect(mine(page.items).length).toBeGreaterThanOrEqual(2);
  });

  it('finds one order by its human number', async () => {
    await seedOrders(1);
    const humanId = `RMP-${run.slice(-5)}0`;
    const page = await listOrders(ctx, STAFF, { humanId });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.humanId).toBe(humanId);
    expect(page.nextCursor).toBeNull();
  });
});
