import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReservationDoc } from '@romp/contracts';
import { fixedClock } from '@romp/data';
import type * as DataModule from '@romp/data';

type StoredReservation = DataModule.WithId<ReservationDoc>;

let expired: StoredReservation[] = [];

vi.mock('@romp/data', async (importOriginal) => {
  const actual = await importOriginal<typeof DataModule>();
  return {
    ...actual,
    listExpiredReservations: (): Promise<readonly StoredReservation[]> => Promise.resolve(expired),
  };
});

const { measureReservationBacklog } = await import('./backlog');

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ctx = { clock: fixedClock(NOW) } as DataModule.StoreContext;

function reservation(id: string, overdueMinutes: number): StoredReservation {
  return {
    id,
    orderId: 'order-1',
    items: [{ variantId: 'WB-240', qty: 1, allocation: { blr: 1 } }],
    status: 'active',
    createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    expiresAt: new Date(NOW.getTime() - overdueMinutes * 60 * 1000),
    resolvedAt: null,
  } as unknown as StoredReservation;
}

afterEach(() => {
  expired = [];
});

describe('measureReservationBacklog', () => {
  it('reports no backlog when nothing is overdue', async () => {
    expired = [];
    const backlog = await measureReservationBacklog(ctx);
    expect(backlog.oldestOverdueAgeMs).toBeNull();
    expect(backlog.overdueCount).toBe(0);
  });

  it('reports the age of the oldest overdue reservation and the count', async () => {
    expired = [reservation('a', 30), reservation('b', 5)];
    const backlog = await measureReservationBacklog(ctx);
    expect(backlog.overdueCount).toBe(2);
    expect(backlog.oldestOverdueAgeMs).toBe(30 * 60 * 1000);
  });
});
