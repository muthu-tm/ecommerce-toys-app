import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderDoc } from '@romp/contracts';
import { anOrder } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  asOperator,
  computeDailyRollup,
  converters,
  createStoreContext,
  listDailyAnalytics,
  systemClock,
} from '@romp/data';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The analytics rollup against real Firestore.
 *
 * `@romp/core` unit-tests the arithmetic and the day window; this proves the read-aggregate-write
 * end to end: orders placed in a store-local day are aggregated into one rollup document, a day
 * outside the window is excluded, a re-run overwrites rather than duplicates, and the dashboard reads
 * a date range back oldest-first.
 */

let app: App;
let ctx: StoreContext;
const STAFF = asOperator('staff-uid-0001', 'staff');
const TZ = 'Asia/Kolkata';

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `analytics-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const run = String(Date.now());
let seq = 0;
const nextId = (): string => {
  seq += 1;
  return `an-${run}-${String(seq)}`;
};

/** The default order total from the fixture — every seeded order uses it, so revenue is a multiple. */
const ORDER_TOTAL = 290_976;

async function seedOrder(status: OrderDoc['status'], createdAt: Date): Promise<void> {
  const paid = status === 'paid';
  await ctx.db
    .doc(`orders/${nextId()}`)
    .withConverter(converters.orders)
    .set(
      anOrder({
        status,
        createdAt,
        updatedAt: createdAt,
        payment: {
          ...anOrder().payment,
          ...(paid
            ? {
                upiRef: '412398765432' as OrderDoc['payment']['upiRef'],
                submittedAt: createdAt,
                verifiedBy: 'staff-uid-0001' as OrderDoc['payment']['verifiedBy'],
                verifiedAt: createdAt,
              }
            : {}),
        },
      }),
    );
}

describe('computeDailyRollup against Firestore', () => {
  // A dedicated app/date per run so the shared emulator database does not blur assertions. The
  // rollup document ID is the date, so a unique date isolates this test's writes.
  const dayNumber = 2 + (Number(run.slice(-4)) % 26); // 2..27, so dayNumber-1 is a valid date
  const date = `2026-04-${String(dayNumber).padStart(2, '0')}`;

  it('aggregates a store-local day and excludes orders outside the window', async () => {
    // Local midnight on `date` in +05:30 is 18:30 UTC the previous day, so the window is that instant
    // to the next. Place orders clearly inside (IST daytime maps to UTC 06:00–17:00 on `date`), and
    // one on the previous local day that must be excluded.
    const dd = String(dayNumber).padStart(2, '0');
    const morningInside = new Date(`2026-04-${dd}T06:00:00.000Z`); // 11:30 IST, inside
    const eveningInside = new Date(`2026-04-${dd}T14:00:00.000Z`); // 19:30 IST, inside
    const rejectedInside = new Date(`2026-04-${dd}T09:00:00.000Z`); // 14:30 IST, inside
    const previousDay = new Date(`2026-04-${String(dayNumber - 1).padStart(2, '0')}T10:00:00.000Z`);

    await seedOrder('paid', morningInside);
    await seedOrder('paid', eveningInside);
    await seedOrder('payment_rejected', rejectedInside);
    await seedOrder('paid', previousDay); // previous local day — must be excluded

    const row = await computeDailyRollup(ctx, STAFF, { date, timeZone: TZ });

    expect(row.date).toBe(date);
    expect(row.orderCount).toBe(3);
    expect(row.paidCount).toBe(2);
    expect(row.rejectedCount).toBe(1);
    expect(row.revenueMinor).toBe(2 * ORDER_TOTAL);
    expect(row.aovMinor).toBe(ORDER_TOTAL);
  });

  it('overwrites rather than duplicates on a re-run', async () => {
    const first = await computeDailyRollup(ctx, STAFF, { date, timeZone: TZ });
    const second = await computeDailyRollup(ctx, STAFF, { date, timeZone: TZ });
    // Same document (id = date), same figures — a materialised view recomputed.
    expect(second.id).toBe(first.id);
    expect(second.orderCount).toBe(first.orderCount);

    const stored = await ctx.db
      .collection('analytics/rollups/daily')
      .where('date', '==', date)
      .get();
    expect(stored.size).toBe(1);
  });

  it('reads a date range back oldest-first for the dashboard', async () => {
    const rows = await listDailyAnalytics(ctx, STAFF, { from: '2026-04-01', to: '2026-04-30' });
    const dates = rows.map((r) => r.date);
    // Sorted ascending, and our date is in range.
    expect(dates).toContain(date);
    expect([...dates]).toEqual([...dates].sort());
  });
});
