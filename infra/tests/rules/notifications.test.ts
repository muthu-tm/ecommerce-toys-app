import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import {
  CUSTOMER_UID,
  OTHER_CUSTOMER_UID,
  OWNER_UID,
  STAFF_UID,
  createRulesHarness,
} from '../helpers/rules-env';
import type { RulesHarness } from '../helpers/rules-env';

/**
 * The write matrix. All of it.
 *
 * | Path                 | Client may                     | Constraint                            |
 * | -------------------- | ------------------------------ | ------------------------------------- |
 * | notifications/{id}   | update `readAt`                | addressee; only that key; == request.time; was null |
 * | notifications/{id}   | update `readBy[own uid]`       | staff audience; only own key; == request.time; not already set |
 *
 * That is the entire client write surface of the platform. Which makes this file the
 * one place where rules assert field-level *shape* rather than just identity, and the
 * one place a rule mistake would let a client write something.
 *
 * Read state is modelled twice because the audiences differ. A customer notification
 * has one recipient, so `readAt` is a single instant. A staff notification has many,
 * so `readBy` is a map keyed by uid — a shared `readAt` would let the first admin to
 * open the bell clear a new order for the whole team.
 */

let harness: RulesHarness;

const OWN_NOTIFICATION = 'notifications/own-unread';
const OWN_READ_NOTIFICATION = 'notifications/own-already-read';
const OTHER_NOTIFICATION = 'notifications/other-unread';
const STAFF_NOTIFICATION = 'notifications/staff-unread';
const STAFF_READ_BY_ME = 'notifications/staff-read-by-me';

const EARLIER = Timestamp.fromDate(new Date('2026-02-01T00:00:00.000Z'));

beforeAll(async () => {
  harness = await createRulesHarness();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.env.clearFirestore();
  await harness.seed({
    [OWN_NOTIFICATION]: {
      eventId: 'ev-1',
      audience: 'user',
      userId: CUSTOMER_UID,
      type: 'order_placed',
      title: 'Order placed',
      body: 'Pay within 30 minutes.',
      link: '/account/orders/own-order',
      readAt: null,
      readBy: {},
    },
    [OWN_READ_NOTIFICATION]: {
      eventId: 'ev-2',
      audience: 'user',
      userId: CUSTOMER_UID,
      type: 'payment_verified',
      title: 'Payment verified',
      body: 'Thanks.',
      link: '/account/orders/own-order',
      readAt: EARLIER,
      readBy: {},
    },
    [OTHER_NOTIFICATION]: {
      eventId: 'ev-3',
      audience: 'user',
      userId: OTHER_CUSTOMER_UID,
      type: 'order_placed',
      title: 'Order placed',
      body: 'Pay within 30 minutes.',
      link: '/account/orders/other-order',
      readAt: null,
      readBy: {},
    },
    [STAFF_NOTIFICATION]: {
      eventId: 'ev-4',
      audience: 'admin',
      userId: null,
      type: 'new_order',
      title: 'New order RMP-1001',
      body: 'Awaiting payment.',
      link: '/orders/own-order',
      readAt: null,
      readBy: {},
    },
    [STAFF_READ_BY_ME]: {
      eventId: 'ev-5',
      audience: 'admin',
      userId: null,
      type: 'new_order',
      title: 'New order RMP-1002',
      body: 'Awaiting payment.',
      link: '/orders/other-order',
      readAt: null,
      readBy: { [STAFF_UID]: EARLIER },
    },
  });
});

describe('reading notifications', () => {
  it('allows a customer to read a notification addressed to them', async () => {
    // Read directly through the client SDK, not the API, because the bell is a
    // realtime listener (ADR-0001).
    await assertSucceeds(getDoc(doc(harness.customer(), OWN_NOTIFICATION)));
  });

  it('denies a customer reading another customer notification', async () => {
    await assertFails(getDoc(doc(harness.customer(), OTHER_NOTIFICATION)));
  });

  it('denies an unauthenticated read', async () => {
    await assertFails(getDoc(doc(harness.anonymous(), OWN_NOTIFICATION)));
  });

  it('denies a customer reading a staff notification', async () => {
    // Staff notifications name order references and internal queue state.
    await assertFails(getDoc(doc(harness.customer(), STAFF_NOTIFICATION)));
  });

  it('allows staff to read a staff notification', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), STAFF_NOTIFICATION)));
  });

  it('allows an owner to read a staff notification', async () => {
    await assertSucceeds(getDoc(doc(harness.owner(), STAFF_NOTIFICATION)));
  });

  it('denies staff reading a customer notification', async () => {
    // Not an oversight. A staff member has no operational need for a customer's
    // notification feed, and the audience field is what decides the audience.
    await assertFails(getDoc(doc(harness.staff(), OWN_NOTIFICATION)));
  });

  it('denies a caller holding a role we never issue', async () => {
    await assertFails(getDoc(doc(harness.impostor(), STAFF_NOTIFICATION)));
  });
});

describe('a customer marking their own notification read', () => {
  it('allows setting readAt to the server time', async () => {
    await assertSucceeds(
      updateDoc(doc(harness.customer(), OWN_NOTIFICATION), { readAt: serverTimestamp() }),
    );
  });

  it('denies marking another customer notification read', async () => {
    await assertFails(
      updateDoc(doc(harness.customer(), OTHER_NOTIFICATION), { readAt: serverTimestamp() }),
    );
  });

  it('denies backdating readAt to a chosen timestamp', async () => {
    // `readAt == request.time` is what makes the value a fact about when the server saw
    // the write rather than a claim by the client.
    await assertFails(updateDoc(doc(harness.customer(), OWN_NOTIFICATION), { readAt: EARLIER }));
  });

  it('denies un-reading a notification', async () => {
    await assertFails(updateDoc(doc(harness.customer(), OWN_READ_NOTIFICATION), { readAt: null }));
  });

  it('denies re-stamping a notification that is already read', async () => {
    // Idempotence here is a denial, not an overwrite: allowing a rewrite would let a
    // client churn the document indefinitely at our cost.
    await assertFails(
      updateDoc(doc(harness.customer(), OWN_READ_NOTIFICATION), { readAt: serverTimestamp() }),
    );
  });

  it('denies changing any other field alongside readAt', async () => {
    await assertFails(
      updateDoc(doc(harness.customer(), OWN_NOTIFICATION), {
        readAt: serverTimestamp(),
        title: 'Something else',
      }),
    );
  });

  it('denies changing the title alone', async () => {
    await assertFails(
      updateDoc(doc(harness.customer(), OWN_NOTIFICATION), { title: 'Something else' }),
    );
  });

  it('denies changing the deep link', async () => {
    // A writable `link` on a document rendered as an anchor is an open-redirect and a
    // phishing primitive inside the customer's own account area.
    await assertFails(
      updateDoc(doc(harness.customer(), OWN_NOTIFICATION), { link: 'https://evil.example' }),
    );
  });

  it('denies re-addressing a notification to someone else', async () => {
    await assertFails(
      updateDoc(doc(harness.customer(), OWN_NOTIFICATION), { userId: OTHER_CUSTOMER_UID }),
    );
  });

  it('denies escalating a customer notification to the staff audience', async () => {
    await assertFails(updateDoc(doc(harness.customer(), OWN_NOTIFICATION), { audience: 'admin' }));
  });

  it('denies a customer writing readBy on their own notification', async () => {
    // `readBy` is the staff mechanism. A customer writing it would be writing a field
    // the customer bell never reads, on a document only they can see — harmless in
    // itself, and denied because the write surface is exactly two fields and this is
    // not one of them for this audience.
    await assertFails(
      updateDoc(doc(harness.customer(), OWN_NOTIFICATION), {
        readBy: { [CUSTOMER_UID]: serverTimestamp() },
      }),
    );
  });
});

describe('a staff member marking a staff notification read', () => {
  it('allows adding their own uid to readBy', async () => {
    await assertSucceeds(
      updateDoc(doc(harness.staff(), STAFF_NOTIFICATION), {
        readBy: { [STAFF_UID]: serverTimestamp() },
      }),
    );
  });

  it('allows an owner to do the same', async () => {
    await assertSucceeds(
      updateDoc(doc(harness.owner(), STAFF_NOTIFICATION), {
        readBy: { [OWNER_UID]: serverTimestamp() },
      }),
    );
  });

  it('denies marking it read on behalf of another admin', async () => {
    // The single most important assertion in this file. Without the nested key diff,
    // one admin could clear a new order from another admin's bell — hiding work from
    // the person it was assigned to.
    await assertFails(
      updateDoc(doc(harness.staff(), STAFF_NOTIFICATION), {
        readBy: { [OWNER_UID]: serverTimestamp() },
      }),
    );
  });

  it('denies clearing another admin read state', async () => {
    await assertFails(
      updateDoc(doc(harness.owner(), STAFF_READ_BY_ME), {
        readBy: { [OWNER_UID]: serverTimestamp() },
      }),
    );
  });

  it('denies re-stamping their own entry', async () => {
    await assertFails(
      updateDoc(doc(harness.staff(), STAFF_READ_BY_ME), {
        readBy: { [STAFF_UID]: serverTimestamp() },
      }),
    );
  });

  it('denies backdating their own entry', async () => {
    await assertFails(
      updateDoc(doc(harness.staff(), STAFF_NOTIFICATION), { readBy: { [STAFF_UID]: EARLIER } }),
    );
  });

  it('denies using readAt on a staff notification', async () => {
    // Would mark it read for the whole team.
    await assertFails(
      updateDoc(doc(harness.staff(), STAFF_NOTIFICATION), { readAt: serverTimestamp() }),
    );
  });

  it('denies a customer writing readBy on a staff notification', async () => {
    await assertFails(
      updateDoc(doc(harness.customer(), STAFF_NOTIFICATION), {
        readBy: { [CUSTOMER_UID]: serverTimestamp() },
      }),
    );
  });

  it('denies changing anything else alongside readBy', async () => {
    await assertFails(
      updateDoc(doc(harness.staff(), STAFF_NOTIFICATION), {
        readBy: { [STAFF_UID]: serverTimestamp() },
        link: '/somewhere-else',
      }),
    );
  });
});

describe('creating and deleting notifications', () => {
  it('denies a customer forging a notification', async () => {
    await assertFails(
      setDoc(doc(harness.customer(), 'notifications/forged'), {
        eventId: 'forged',
        audience: 'user',
        userId: CUSTOMER_UID,
        type: 'payment_verified',
        title: 'Payment verified',
        body: 'Definitely paid.',
        link: '/account/orders/own-order',
        readAt: null,
        readBy: {},
      }),
    );
  });

  it('denies staff creating a notification', async () => {
    // Notifications are a projection of the append-only event spine, written by the
    // dispatcher with a deterministic ID. A hand-created one has no event behind it and
    // would be resurrected or orphaned by the next replay.
    await assertFails(
      setDoc(doc(harness.staff(), 'notifications/hand-made'), {
        eventId: 'none',
        audience: 'admin',
        userId: null,
        type: 'new_order',
        title: 'Look at this',
        body: 'Manually added.',
        link: '/orders',
        readAt: null,
        readBy: {},
      }),
    );
  });

  it('denies a customer deleting their own notification', async () => {
    // Deleting locally would be undone by the next dispatcher replay. The TTL policy
    // trims the feed.
    await assertFails(deleteDoc(doc(harness.customer(), OWN_NOTIFICATION)));
  });

  it('denies staff deleting a staff notification', async () => {
    await assertFails(deleteDoc(doc(harness.staff(), STAFF_NOTIFICATION)));
  });
});
