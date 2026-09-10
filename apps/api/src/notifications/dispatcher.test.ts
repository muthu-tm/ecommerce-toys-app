import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredEvent } from '@romp/contracts';
import { money } from '@romp/contracts';
import type * as DataModule from '@romp/data';
import { createSilentLogger } from '@romp/observability';

// Record notification writes without a database: the dispatcher's job is to plan (tested in
// @romp/core) and write; here we assert the write side — how many, with which IDs.
const writes: { id: string; audience: string }[] = [];
vi.mock('@romp/data', async (importOriginal) => {
  const actual = await importOriginal<typeof DataModule>();
  return {
    ...actual,
    writeNotification: (_ctx: unknown, id: string, doc: { audience: string }): Promise<void> => {
      writes.push({ id, audience: doc.audience });
      return Promise.resolve();
    },
  };
});

const { dispatchStoredEvent } = await import('./dispatcher');

const ctx = {} as never;

function orderCreated(): StoredEvent {
  return {
    id: 'event-1' as StoredEvent['id'],
    type: 'order.created',
    actorId: 'system',
    subject: { kind: 'order', id: 'order-1' },
    payload: {
      type: 'order.created',
      orderId: 'order-1',
      humanId: 'ORD-1',
      userId: 'cust-1',
      totalMinor: money(1_000),
      itemCount: 1,
    },
    at: new Date('2026-03-01T09:30:00.000Z'),
  } as StoredEvent;
}

afterEach(() => {
  writes.length = 0;
});

describe('dispatchStoredEvent', () => {
  it('writes one notification per planned recipient and returns the count', async () => {
    const count = await dispatchStoredEvent(ctx, orderCreated(), createSilentLogger());

    expect(count).toBe(2);
    expect(writes.map((w) => w.audience).sort()).toEqual(['admin', 'user']);
  });

  it('is idempotent: dispatching the same event twice targets the same IDs', async () => {
    await dispatchStoredEvent(ctx, orderCreated(), createSilentLogger());
    const first = writes.map((w) => w.id).sort();
    writes.length = 0;
    await dispatchStoredEvent(ctx, orderCreated(), createSilentLogger());
    const second = writes.map((w) => w.id).sort();

    expect(second).toEqual(first);
  });

  it('writes nothing for an event routed to no audience', async () => {
    const rejected = {
      ...orderCreated(),
      id: 'event-2' as StoredEvent['id'],
      type: 'review.rejected',
      payload: {
        type: 'review.rejected',
        reviewId: 'rev-1',
        productId: 'wooden-blocks',
        userId: 'cust-1',
        reason: 'spam',
      },
    } as StoredEvent;

    const count = await dispatchStoredEvent(ctx, rejected, createSilentLogger());
    expect(count).toBe(0);
    expect(writes).toHaveLength(0);
  });
});
