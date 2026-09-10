import { NOTIFICATION_ROUTES } from '@romp/core';
import { listRecentEvents, notificationsExistForEvent } from '@romp/data';
import type { StoreContext } from '@romp/data';

/**
 * Measures the dispatch backlog: how far behind the dispatcher is.
 *
 * The metric that matters is **age**, not error count. There is no email fallback, so a
 * dispatcher that has stopped being invoked is silent customer harm — and a dispatcher that
 * has stopped throws nothing. So this looks at recent events and finds the oldest one that
 * *should* have produced a notification but has none, and reports its age.
 *
 * "Should have produced one" is read from the same routing table the dispatcher uses: an
 * event routed to neither audience (a rejected review) is never a backlog, however old. That
 * keeps the alarm from firing on events that are correctly silent.
 *
 * Bounded by design: it scans a recent window, not the whole spine. A backlog older than the
 * window is already a page-worthy incident the age-of-newest signal would have caught; the
 * window is sized to the schedule so nothing in a healthy system is missed.
 */
export interface DispatchBacklog {
  /** Age of the oldest undispatched event in ms, or null if there is no backlog. */
  readonly oldestUndispatchedAgeMs: number | null;
  readonly undispatchedCount: number;
}

/** How many recent events to inspect per run. Sized well above one schedule cycle's volume. */
const WINDOW = 200;

export async function measureDispatchBacklog(ctx: StoreContext): Promise<DispatchBacklog> {
  const recent = await listRecentEvents(ctx, WINDOW);
  const now = ctx.clock.now().getTime();

  let oldestAgeMs: number | null = null;
  let undispatchedCount = 0;

  for (const event of recent) {
    const route = NOTIFICATION_ROUTES[event.type];
    // An event routed to nobody is never a backlog.
    if (route.customer === null && route.admin === null) continue;

    const dispatched = await notificationsExistForEvent(ctx, event.id);
    if (dispatched) continue;

    undispatchedCount += 1;
    const ageMs = now - event.at.getTime();
    if (oldestAgeMs === null || ageMs > oldestAgeMs) oldestAgeMs = ageMs;
  }

  return { oldestUndispatchedAgeMs: oldestAgeMs, undispatchedCount };
}
