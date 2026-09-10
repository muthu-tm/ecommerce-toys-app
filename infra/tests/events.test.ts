import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EventDoc, NotificationDoc } from '@romp/contracts';
import { money, notificationId } from '@romp/contracts';
import {
  appendEvent,
  converters,
  createStoreContext,
  getDocument,
  systemClock,
  writeNotification,
} from '@romp/data';
import type { StoreContext } from '@romp/data';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The event spine and notification writes against real Firestore.
 *
 * `@romp/data`'s recorder tests assert query shape; this asserts the writes actually land
 * and validate — an event appends with a generated ID and reads back through its converter,
 * and a notification set with a deterministic ID is an overwrite on replay rather than a
 * duplicate.
 */

let app: App;
let ctx: StoreContext;

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `events-${String(Date.now())}`);
  ctx = createStoreContext({
    storeId: 'test-store',
    db: getFirestore(app),
    clock: systemClock,
  });
});

afterAll(async () => {
  await deleteApp(app);
});

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
    at: new Date('2026-03-01T09:30:00.000Z'),
  } as EventDoc;
}

describe('appendEvent', () => {
  it('appends an event and returns it with a generated id', async () => {
    const stored = await appendEvent(ctx, anOrderCreatedEvent());
    expect(stored.id).toBeTruthy();

    // It reads back through its converter (Date fields round-trip via Timestamp).
    const readBack = await getDocument(ctx, `events/${stored.id}`, converters.events);
    expect(readBack?.type).toBe('order.created');
    expect(readBack?.at.getTime()).toBe(anOrderCreatedEvent().at.getTime());
  });
});

describe('writeNotification', () => {
  function aNote(eventId: string): NotificationDoc {
    return {
      eventId: eventId as NotificationDoc['eventId'],
      audience: 'user',
      userId: 'cust-evt-1' as NotificationDoc['userId'],
      type: 'order_placed',
      title: 'Order placed',
      body: 'Pay to confirm.',
      link: '/account/orders/RMP-90001',
      readAt: null,
      readBy: {},
      createdAt: new Date('2026-03-01T09:30:00.000Z'),
      expiresAt: new Date('2026-03-31T09:30:00.000Z'),
    };
  }

  it('writes a notification at its deterministic id, and a replay overwrites rather than duplicates', async () => {
    const eventId = 'event-write-1';
    const id = notificationId(eventId, 'user', 'cust-evt-1');

    await writeNotification(ctx, id, aNote(eventId));
    await writeNotification(ctx, id, { ...aNote(eventId), title: 'Order placed (v2)' });

    // Only one document exists at that id, carrying the latest write.
    const readBack = await getDocument(ctx, `notifications/${id}`, converters.notifications);
    expect(readBack?.title).toBe('Order placed (v2)');

    const all = await getFirestore(app)
      .collection('notifications')
      .where('eventId', '==', eventId)
      .get();
    expect(all.size).toBe(1);
  });
});
