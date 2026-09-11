import { asSystem, listExpiredReservations } from '@romp/data';
import type { StoreContext } from '@romp/data';

/**
 * Measures the reservation-release backlog: expired holds the sweeper has not yet freed.
 *
 * The metric that matters is **age**, not error count — the same reasoning as the dispatch backlog.
 * A sweeper that has stopped being invoked leaks stock indefinitely and throws nothing, so an
 * error-rate alarm on it fires only when it is working well enough to fail. This measures the age of
 * the oldest reservation that is past its expiry and still `active`, so a stalled sweeper shows up as
 * a growing age even though nothing errored.
 *
 * It is measured *after* a sweep pass, so in a healthy system it reads near zero: the pass just
 * released everything overdue. A large age here means the pass could not keep up — contention, a
 * repeated transaction failure, or the function not running at all — which is exactly the condition
 * the alert exists for. `RUNBOOKS.md` runbook 2 is the response.
 */
export interface ReservationBacklog {
  /** Age of the oldest still-active overdue reservation in ms, or null if none is overdue. */
  readonly oldestOverdueAgeMs: number | null;
  /** How many overdue reservations remain active (bounded by the list window). */
  readonly overdueCount: number;
}

export async function measureReservationBacklog(ctx: StoreContext): Promise<ReservationBacklog> {
  const overdue = await listExpiredReservations(ctx, asSystem('reservation backlog measure'));
  const now = ctx.clock.now().getTime();

  let oldestOverdueAgeMs: number | null = null;
  for (const reservation of overdue) {
    const ageMs = now - reservation.expiresAt.getTime();
    if (oldestOverdueAgeMs === null || ageMs > oldestOverdueAgeMs) oldestOverdueAgeMs = ageMs;
  }

  return { oldestOverdueAgeMs, overdueCount: overdue.length };
}
