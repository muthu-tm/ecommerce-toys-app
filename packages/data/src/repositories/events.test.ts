import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import type { EventDoc, NotificationDoc } from '@romp/contracts';
import { money } from '@romp/contracts';

import { fixedClock } from '../clock';
import { createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

import {
  appendEvent,
  appendEventInTransaction,
  listRecentEvents,
  notificationsExistForEvent,
  writeNotification,
} from './events';

/**
 * Unit tests for the event spine and notification writes.
 *
 * These assert the shape of the calls each repository makes — that `appendEvent` does a
 * converter-backed `add`, that `writeNotification` does a `set` (not a `create`, which is
 * what makes replay idempotent), that `appendEventInTransaction` allocates the ID before
 * commit, and that the two backlog reads build the queries the alarm depends on. The
 * end-to-end behaviour against real Firestore — Date round-tripping, idempotent overwrite —
 * is asserted in `infra/tests/events.test.ts`; here the concern is the query, which an
 * emulator cannot distinguish from a subtly wrong one.
 */

const NOW = new Date('2026-03-01T09:30:00.000Z');

/** An `order.created` spine event, built inline — there is no `EventDoc` fixture. */
function anOrderCreatedEvent(): EventDoc {
  return {
    type: 'order.created',
    actorId: 'system',
    subject: { kind: 'order', id: 'order-evt-1' },
    payload: {
      type: 'order.created',
      orderId: 'order-evt-1',
      humanId: 'RMP-90001',
      userId: 'cust-evt-1',
      totalMinor: money(129_900),
      itemCount: 1,
    },
    at: NOW,
  } as EventDoc;
}

/** A customer notification document. */
function aNote(): NotificationDoc {
  return {
    eventId: 'event-write-1' as NotificationDoc['eventId'],
    audience: 'user',
    userId: 'cust-evt-1' as NotificationDoc['userId'],
    type: 'order_placed',
    title: 'Order placed',
    body: 'Pay to confirm.',
    link: '/account/orders/RMP-90001',
    readAt: null,
    readBy: {},
    createdAt: NOW,
    expiresAt: new Date('2026-03-31T09:30:00.000Z'),
  };
}

/** A minimal write-capable Firestore double recording adds, sets and query clauses. */
function fakeDb(queryDocs: readonly { id: string; data: unknown }[] = []) {
  const record = {
    added: [] as { path: string; data: unknown }[],
    set: [] as { path: string; data: unknown }[],
    allocatedIds: [] as string[],
    clauses: [] as { kind: string; args: readonly unknown[] }[],
  };
  let allocated = 0;

  const collectionChain = (path: string) => {
    let converter: { fromFirestore: (s: unknown) => unknown } | null = null;
    const chain = {
      withConverter: (c: typeof converter) => {
        converter = c;
        return chain;
      },
      add: (data: unknown) => {
        record.added.push({ path, data });
        return Promise.resolve({ id: 'generated-event-id' });
      },
      doc: () => {
        const id = `alloc-${String((allocated += 1))}`;
        record.allocatedIds.push(id);
        return { id };
      },
      where: (...args: readonly unknown[]) => {
        record.clauses.push({ kind: 'where', args });
        return chain;
      },
      orderBy: (...args: readonly unknown[]) => {
        record.clauses.push({ kind: 'orderBy', args });
        return chain;
      },
      limit: (...args: readonly unknown[]) => {
        record.clauses.push({ kind: 'limit', args });
        return chain;
      },
      get: () =>
        Promise.resolve({
          empty: queryDocs.length === 0,
          docs: queryDocs.map((d) => ({
            id: d.id,
            data: () =>
              converter === null
                ? d.data
                : converter.fromFirestore({ id: d.id, data: () => d.data }),
          })),
        }),
    };
    return chain;
  };

  const docChain = (path: string) => {
    const ref = {
      withConverter: () => ref,
      set: (data: unknown) => {
        record.set.push({ path, data });
        return Promise.resolve();
      },
    };
    return ref;
  };

  const db = {
    collection: collectionChain,
    doc: docChain,
  } as unknown as Firestore;

  return { db, record };
}

function ctxWith(db: Firestore): StoreContext {
  return createStoreContext({ storeId: 'romp', db, clock: fixedClock(NOW) });
}

describe('appendEvent', () => {
  it('adds the event through the events converter and returns the generated ID', async () => {
    const { db, record } = fakeDb();

    const stored = await appendEvent(ctxWith(db), anOrderCreatedEvent());

    expect(stored.id).toBe('generated-event-id');
    expect(record.added).toHaveLength(1);
    expect(record.added[0]?.path).toBe(COLLECTIONS.events);
  });
});

describe('appendEventInTransaction', () => {
  it('allocates the ID up front and sets the event in the transaction', () => {
    const { db, record } = fakeDb();
    const set = vi.fn();
    const tx = { set } as unknown as Transaction;

    const stored = appendEventInTransaction(tx, ctxWith(db), anOrderCreatedEvent());

    // The ID is known before commit, because a notification's ID derives from it.
    expect(stored.id).toBe('alloc-1');
    expect(record.allocatedIds).toEqual(['alloc-1']);
    expect(set).toHaveBeenCalledOnce();
  });
});

describe('writeNotification', () => {
  it('writes with set (not create) at the notification path, for idempotent replay', async () => {
    const { db, record } = fakeDb();

    await writeNotification(ctxWith(db), 'ev-1_user_cust-1', aNote());

    expect(record.set).toHaveLength(1);
    expect(record.set[0]?.path).toBe(paths.notification('ev-1_user_cust-1'));
  });
});

describe('listRecentEvents', () => {
  it('orders by time descending and bounds by the given limit', async () => {
    const encoded = converters.events.toFirestore(anOrderCreatedEvent()) as Record<string, unknown>;
    const { db, record } = fakeDb([{ id: 'ev-1', data: encoded }]);

    const events = await listRecentEvents(ctxWith(db), 200);

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('ev-1');
    expect(record.clauses).toContainEqual({ kind: 'orderBy', args: ['at', 'desc'] });
    expect(record.clauses).toContainEqual({ kind: 'limit', args: [200] });
  });
});

describe('notificationsExistForEvent', () => {
  it('is true when a notification for the event exists', async () => {
    const { db, record } = fakeDb([{ id: 'n-1', data: {} }]);

    const exists = await notificationsExistForEvent(ctxWith(db), 'ev-1');

    expect(exists).toBe(true);
    expect(record.clauses).toContainEqual({ kind: 'where', args: ['eventId', '==', 'ev-1'] });
    expect(record.clauses).toContainEqual({ kind: 'limit', args: [1] });
  });

  it('is false when no notification exists for the event', async () => {
    const { db } = fakeDb([]);

    expect(await notificationsExistForEvent(ctxWith(db), 'ev-2')).toBe(false);
  });
});
