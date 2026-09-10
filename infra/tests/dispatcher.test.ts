import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dispatchStoredEvent } from '@romp/api/notifications/dispatcher';
import type { EventDoc } from '@romp/contracts';
import { money } from '@romp/contracts';
import { appendEvent, createStoreContext, systemClock } from '@romp/data';
import type { StoreContext } from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The notification dispatcher against real Firestore.
 *
 * This drives the dispatcher's core — the same function the Firestore trigger calls — over
 * the emulator: append an event, dispatch it, and assert the notifications the routing table
 * says it should produce actually land. It does not run the trigger itself (that needs the
 * Functions emulator, which this harness does not start); the trigger is a three-line
 * decode-and-call wrapper, and the decode is covered by the event converter's own tests.
 */

let app: App;
let ctx: StoreContext;
const logger = createSilentLogger();

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `dispatcher-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

function orderCreated(userId: string): EventDoc {
  return {
    type: 'order.created',
    actorId: 'system',
    subject: { kind: 'order', id: 'order-disp-1' },
    payload: {
      type: 'order.created',
      orderId: 'order-disp-1',
      humanId: 'ORD-70001',
      userId,
      totalMinor: money(129_900),
      itemCount: 1,
    },
    at: new Date('2026-03-01T09:30:00.000Z'),
  } as EventDoc;
}

async function notificationsFor(eventId: string): Promise<{ audience: string }[]> {
  const snapshot = await getFirestore(app)
    .collection('notifications')
    .where('eventId', '==', eventId)
    .get();
  return snapshot.docs.map((doc) => doc.data() as { audience: string });
}

describe('dispatchStoredEvent over the emulator', () => {
  it('produces one customer and one admin notification for order.created', async () => {
    const stored = await appendEvent(ctx, orderCreated('cust-disp-1'));
    const count = await dispatchStoredEvent(ctx, stored, logger);
    expect(count).toBe(2);

    const notes = await notificationsFor(stored.id);
    expect(notes.map((n) => n.audience).sort()).toEqual(['admin', 'user']);
  });

  it('is idempotent: dispatching the same event twice leaves one notification per recipient', async () => {
    const stored = await appendEvent(ctx, orderCreated('cust-disp-2'));

    await dispatchStoredEvent(ctx, stored, logger);
    await dispatchStoredEvent(ctx, stored, logger); // replay

    const notes = await notificationsFor(stored.id);
    // Deterministic IDs mean the replay overwrote rather than duplicated.
    expect(notes).toHaveLength(2);
  });

  it('renders the configured template with the order reference', async () => {
    const stored = await appendEvent(ctx, orderCreated('cust-disp-3'));
    await dispatchStoredEvent(ctx, stored, logger);

    const snapshot = await getFirestore(app)
      .collection('notifications')
      .where('eventId', '==', stored.id)
      .where('audience', '==', 'user')
      .get();
    const customer = snapshot.docs[0]?.data() as { title: string; link: string } | undefined;
    expect(customer?.title).toContain('ORD-70001');
    expect(customer?.link).toBe('/account/orders/ORD-70001');
  });
});
