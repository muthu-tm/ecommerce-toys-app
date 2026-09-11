import type { DailyAnalyticsDoc } from '@romp/contracts';
import { aggregateDailyOrders, zonedDayWindow } from '@romp/core';
import type { RollupOrder } from '@romp/core';

import type { Caller, StoreContext } from '../context';
import { requireStaff } from '../context';
import type { WithId } from '../converter';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

import { runQuery } from './read';

/**
 * The daily analytics rollup — the write behind the dashboard's promise never to scan `orders` on
 * read.
 *
 * A scheduled job calls `computeDailyRollup` once per day (and re-runnably for a backfill): it reads
 * the orders placed in that store-local day, aggregates them with the pure `@romp/core` arithmetic,
 * and writes one `analytics/rollups/daily/{date}` document. The dashboard then reads a *range* of
 * those small documents (`listDailyAnalytics`) — a bounded read of pre-computed rows rather than an
 * aggregation over a growing collection on every page load (`DATA_MODEL.md`).
 *
 * The timezone is a parameter, not read from a config module here: `@romp/data` stays config-
 * agnostic (ADR-0005), and the store's `locale.timezone` is threaded in by the caller, exactly as
 * the checkout settings are. That is what decides where a "day" starts — a late-evening sale in
 * Bengaluru belongs to that date, not the UTC one it would slip into.
 */

/** Reads the orders placed in a store-local day and writes that day's rollup. Re-runnable. */
export async function computeDailyRollup(
  ctx: StoreContext,
  caller: Caller,
  input: { readonly date: string; readonly timeZone: string },
): Promise<WithId<DailyAnalyticsDoc>> {
  requireStaff(caller, { resource: 'analytics' });

  const window = zonedDayWindow(input.date, input.timeZone);

  // A single range on `createdAt` — served by the automatic single-field index, no composite needed.
  const orders = await runQuery(
    ctx.db
      .collection(COLLECTIONS.orders)
      .withConverter(converters.orders)
      .where('createdAt', '>=', window.startInclusive)
      .where('createdAt', '<', window.endExclusive),
  );

  const rollupOrders: RollupOrder[] = orders.map((order) => ({
    status: order.status,
    totalMinor: order.amounts.totalMinor,
    refundedMinor: order.amounts.refundedMinor,
  }));

  const figures = aggregateDailyOrders(rollupOrders);

  const doc: DailyAnalyticsDoc = {
    date: input.date,
    ...figures,
    computedAt: ctx.clock.now(),
  };

  // The document ID is the date, so a re-run overwrites the day rather than duplicating it — the
  // rollup is a materialised view, and recomputing it is always safe.
  const ref = ctx.db.doc(paths.dailyAnalytics(input.date)).withConverter(converters.dailyAnalytics);
  await ref.set(doc);

  return { id: input.date, ...doc };
}

/**
 * The dashboard read: the rollup rows for a date range, oldest first.
 *
 * Staff-only — revenue is not a public figure (`SECURITY.md`). Inclusive of both ends, because a
 * dashboard "last 30 days" means exactly those 30 dates. The dates are `yyyy-mm-dd` strings, and the
 * rollup document ID *is* the date, so a lexicographic range on `__name__` is a chronological range —
 * no separate date field or index is needed. A missing day (the job has not run, or there were no
 * orders and it was never written) simply does not appear; the caller fills gaps with zeroes if it
 * charts a continuous axis.
 */
export async function listDailyAnalytics(
  ctx: StoreContext,
  caller: Caller,
  range: { readonly from: string; readonly to: string },
): Promise<readonly WithId<DailyAnalyticsDoc>[]> {
  requireStaff(caller, { resource: 'analytics' });

  return runQuery(
    ctx.db
      .collection(paths.dailyAnalyticsCollection())
      .withConverter(converters.dailyAnalytics)
      .where('date', '>=', range.from)
      .where('date', '<=', range.to)
      .orderBy('date', 'asc'),
  );
}
