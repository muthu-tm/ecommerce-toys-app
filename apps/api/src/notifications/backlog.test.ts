import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredEvent } from '@romp/contracts';
import { fixedClock } from '@romp/data';
import type * as DataModule from '@romp/data';

let recentEvents: StoredEvent[] = [];
let dispatchedIds = new Set<string>();

vi.mock('@romp/data', async (importOriginal) => {
  const actual = await importOriginal<typeof DataModule>();
  return {
    ...actual,
    listRecentEvents: (): Promise<readonly StoredEvent[]> => Promise.resolve(recentEvents),
    notificationsExistForEvent: (_ctx: unknown, eventId: string): Promise<boolean> =>
      Promise.resolve(dispatchedIds.has(eventId)),
  };
});

const { measureDispatchBacklog } = await import('./backlog');

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ctx = { clock: fixedClock(NOW) } as DataModule.StoreContext;

function event(id: string, type: StoredEvent['type'], ageMinutes: number): StoredEvent {
  return {
    id: id as StoredEvent['id'],
    type,
    actorId: 'system',
    subject: { kind: 'order', id: 'order-1' },
    payload: { type, orderId: 'order-1', humanId: 'ORD-1', userId: 'cust-1' },
    at: new Date(NOW.getTime() - ageMinutes * 60 * 1000),
  } as StoredEvent;
}

afterEach(() => {
  recentEvents = [];
  dispatchedIds = new Set();
});

describe('measureDispatchBacklog', () => {
  it('reports no backlog when every routed event has notifications', async () => {
    recentEvents = [event('a', 'order.packed', 10), event('b', 'order.shipped', 5)];
    dispatchedIds = new Set(['a', 'b']);

    const backlog = await measureDispatchBacklog(ctx);
    expect(backlog.oldestUndispatchedAgeMs).toBeNull();
    expect(backlog.undispatchedCount).toBe(0);
  });

  it('reports the age of the oldest undispatched routed event', async () => {
    recentEvents = [event('old', 'order.packed', 30), event('new', 'order.shipped', 2)];
    dispatchedIds = new Set(['new']); // 'old' is undispatched

    const backlog = await measureDispatchBacklog(ctx);
    expect(backlog.undispatchedCount).toBe(1);
    expect(backlog.oldestUndispatchedAgeMs).toBe(30 * 60 * 1000);
  });

  it('never counts an event routed to nobody as a backlog', async () => {
    // review.rejected notifies nobody, so however old and undispatched, it is not a backlog.
    recentEvents = [
      {
        ...event('r', 'review.rejected', 120),
        payload: {
          type: 'review.rejected',
          reviewId: 'rev-1',
          productId: 'wooden-blocks',
          userId: 'cust-1',
          reason: 'spam',
        },
      } as StoredEvent,
    ];
    dispatchedIds = new Set();

    const backlog = await measureDispatchBacklog(ctx);
    expect(backlog.oldestUndispatchedAgeMs).toBeNull();
    expect(backlog.undispatchedCount).toBe(0);
  });
});
