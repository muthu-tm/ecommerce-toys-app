import { money, sumMoney, ZERO_MONEY } from '@romp/contracts';
import type { Money } from '@romp/contracts';

/**
 * The pure analytics-rollup logic.
 *
 * The admin dashboard must never scan `orders` on read — a busy store's order collection is the last
 * thing to run an aggregation over on every dashboard load (`DATA_MODEL.md`). So a scheduled job
 * rolls each day up into one small `analytics/rollups/daily/{date}` document, and the dashboard reads
 * a range of those. This file is the arithmetic behind that job: it decides which UTC window a store
 * "day" covers, and it turns a day's orders into the row. Both are pure — no Firestore, no clock read
 * that is not passed in — so the `@romp/data` job is a thin read-aggregate-write around them.
 */

/** A half-open instant window `[startInclusive, endExclusive)`. */
export interface DayWindow {
  readonly startInclusive: Date;
  readonly endExclusive: Date;
}

/**
 * The UTC instants bounding one calendar day in a store's timezone.
 *
 * A "day" is the store's local day, not a UTC day — a sale at 11pm in Bengaluru belongs to that
 * date, not the next one it would fall into in UTC. So the rollup for `2026-03-01` covers local
 * midnight to the next local midnight, expressed as the UTC instants Firestore compares
 * `createdAt` against. The offset is read from the runtime's own tz database via `Intl` rather than
 * hard-coded, so a zone with a half-hour offset (India is +05:30) or a future DST change is handled
 * without a table to maintain.
 *
 * The window is **half-open**: the end is the next day's start, excluded, so an order at exactly
 * local midnight belongs to one day only and no order is double-counted at a boundary.
 */
export function zonedDayWindow(date: string, timeZone: string): DayWindow {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    throw new RangeError(`A rollup date is yyyy-mm-dd, got ${date}.`);
  }
  const [, year, month, day] = match.map(Number) as [number, number, number, number];

  const startInclusive = zonedMidnightUtc(year, month, day, timeZone);
  // The next local midnight — add 24h to the *local* day, then resolve its instant, so a DST jump
  // inside the day does not make the window 23 or 25 hours by accident.
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const endExclusive = zonedMidnightUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );

  return { startInclusive, endExclusive };
}

/**
 * The UTC instant of local midnight for a `(year, month, day)` in a timezone.
 *
 * Found by asking what wall-clock time the timezone shows for a provisional UTC instant, then
 * correcting by the difference. One correction is exact for every fixed and half-hour offset; the
 * result is the instant whose local calendar time is `00:00:00` on that date.
 */
function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const provisional = Date.UTC(year, month - 1, day, 0, 0, 0);
  const asSeen = wallClockUtc(new Date(provisional), timeZone);
  // `asSeen - provisional` is the zone's offset at that instant; subtracting it lands local midnight.
  const offset = asSeen - provisional;
  return new Date(provisional - offset);
}

/**
 * The UTC-epoch value that the timezone's wall clock reads at a given instant.
 *
 * `Intl.DateTimeFormat` renders the instant in the target zone; reading those fields back as if they
 * were UTC yields a number whose difference from the real instant is exactly the zone offset.
 */
function wallClockUtc(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const field = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // `hour` can render as `24` at midnight in some engines; normalise to `0`.
  const hour = field('hour') % 24;
  return Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    hour,
    field('minute'),
    field('second'),
  );
}

/** The minimum an order contributes to a rollup — its status, total and refunded amount. */
export interface RollupOrder {
  readonly status:
    | 'awaiting_payment'
    | 'pending_verification'
    | 'paid'
    | 'payment_rejected'
    | 'expired'
    | 'cancelled'
    | 'refunded';
  readonly totalMinor: Money;
  readonly refundedMinor: Money;
}

/** The computed rollup figures, matching `DailyAnalyticsDoc` minus `date` and `computedAt`. */
export interface DailyRollup {
  readonly revenueMinor: Money;
  readonly orderCount: number;
  readonly paidCount: number;
  readonly rejectedCount: number;
  readonly refundedMinor: Money;
  readonly aovMinor: Money;
}

/** Statuses that count as a settled sale: money confirmed to have arrived. */
const REVENUE_STATUSES = new Set<RollupOrder['status']>(['paid', 'refunded']);

/**
 * Aggregates a day's orders into the rollup figures.
 *
 * `orderCount` is every order placed in the window. `paidCount` and `revenueMinor` count only the
 * settled ones — `paid` and `refunded`, since a refunded order's money did arrive before it went
 * back, and the refund is tracked separately in `refundedMinor`. `rejectedCount` is the orders an
 * admin could not match. `aovMinor` is revenue over paid orders, rounded to the nearest paise, and
 * exactly zero when there were no paid orders — the schema refuses a carried-forward average with no
 * sales behind it, and this is where that invariant is produced rather than merely asserted.
 */
export function aggregateDailyOrders(orders: readonly RollupOrder[]): DailyRollup {
  const paid = orders.filter((order) => REVENUE_STATUSES.has(order.status));
  const revenueMinor =
    paid.length === 0 ? ZERO_MONEY : sumMoney(paid.map((order) => order.totalMinor));
  const refundedMinor =
    orders.length === 0 ? ZERO_MONEY : sumMoney(orders.map((order) => order.refundedMinor));

  const paidCount = paid.length;
  const aovMinor = paidCount === 0 ? ZERO_MONEY : money(Math.round(revenueMinor / paidCount));

  return {
    revenueMinor,
    orderCount: orders.length,
    paidCount,
    rejectedCount: orders.filter((order) => order.status === 'payment_rejected').length,
    refundedMinor,
    aovMinor,
  };
}
