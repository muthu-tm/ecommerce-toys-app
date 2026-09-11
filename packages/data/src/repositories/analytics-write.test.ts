import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { NotFoundError } from '@romp/observability';

import { fixedClock } from '../clock';
import { asCustomer, ANONYMOUS, createStoreContext } from '../context';
import type { StoreContext } from '../context';

import { computeDailyRollup, listDailyAnalytics } from './analytics-write';

/**
 * Unit tests for the analytics rollup guards.
 *
 * The aggregation arithmetic and the day-window are unit-tested in `@romp/core`, and the
 * read-aggregate-write is proven against the emulator. Here the only thing left to assert without a
 * database is the access gate: revenue is staff-only, so a customer or an anonymous caller is refused
 * before any query is built — the check is first, so the stub `db` is never touched.
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');

function ctx(): StoreContext {
  // The guard throws before any query, so a bare stub db is enough.
  return createStoreContext({
    storeId: 'test-store',
    db: {} as unknown as Firestore,
    clock: fixedClock(NOW),
  });
}

describe('computeDailyRollup access', () => {
  it('refuses a customer', async () => {
    await expect(
      computeDailyRollup(ctx(), asCustomer('customer-1'), {
        date: '2026-03-01',
        timeZone: 'Asia/Kolkata',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses an anonymous caller', async () => {
    await expect(
      computeDailyRollup(ctx(), ANONYMOUS, { date: '2026-03-01', timeZone: 'Asia/Kolkata' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('listDailyAnalytics access', () => {
  it('refuses a customer', async () => {
    await expect(
      listDailyAnalytics(ctx(), asCustomer('customer-1'), { from: '2026-03-01', to: '2026-03-31' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses an anonymous caller', async () => {
    await expect(
      listDailyAnalytics(ctx(), ANONYMOUS, { from: '2026-03-01', to: '2026-03-31' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
