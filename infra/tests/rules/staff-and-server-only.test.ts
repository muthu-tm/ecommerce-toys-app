import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { createRulesHarness } from '../helpers/rules-env';
import type { RulesHarness } from '../helpers/rules-env';

/**
 * Read matrix — staff-only and server-only rows.
 *
 * | Collection        | Public | Owner | Staff | Why                                          |
 * | ----------------- | ------ | ----- | ----- | -------------------------------------------- |
 * | inventory         | no     | no    | yes   | exact stock is commercially sensitive        |
 * | warehouses        | no     | no    | yes   | operational geography                        |
 * | reservations      | no     | no    | yes   | reveals in-flight demand                     |
 * | inventoryLedger   | no     | no    | yes   | movement history                             |
 * | analytics         | no     | no    | yes   | revenue is not a public figure               |
 * | events            | no     | no    | no    | the audit spine, actor identities store-wide |
 * | identityIndex     | no     | no    | no    | bulk account-enumeration oracle              |
 * | paymentRefGuards  | no     | no    | no    | leaks whether a UTR is spent                 |
 * | counters          | no     | no    | no    | discloses order volume                       |
 *
 * The four server-only rows are denied to *staff as well*. That is deliberate in every
 * case: none of them serves an operational need the API cannot meet, and each is a
 * disclosure whose blast radius is the whole store rather than one document.
 */

let harness: RulesHarness;

beforeAll(async () => {
  harness = await createRulesHarness();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.env.clearFirestore();
  await harness.seed({
    'inventory/SKU-1': { productId: 'p1', stock: { blr: 12 }, onHandTotal: 12, reserved: 0 },
    'warehouses/blr': { code: 'blr', name: 'Bengaluru hub', active: true },
    'reservations/res-1': { orderId: 'own-order', status: 'active', items: [] },
    'inventoryLedger/entry-1': { variantId: 'SKU-1', warehouseId: 'blr', delta: 12 },
    'analytics/rollups': { note: 'parent document' },
    'analytics/rollups/daily/2026-03-01': { revenueMinor: 581_952, orderCount: 3 },
    'events/ev-1': { type: 'order.payment_verified', actorId: 'staff-uid-0001' },
    'identityIndex/asha@example.com': { uid: 'customer-uid-0001', type: 'email' },
    'identityIndex/+919845021174': { uid: 'customer-uid-0001', type: 'phone' },
    'paymentRefGuards/412398765432': { orderId: 'own-order' },
    'counters/orderHumanId': { value: 1_042 },
  });
});

/** Every path a customer and an anonymous caller must not reach. */
const CLOSED_TO_CUSTOMERS = [
  'inventory/SKU-1',
  'warehouses/blr',
  'reservations/res-1',
  'inventoryLedger/entry-1',
  'analytics/rollups/daily/2026-03-01',
  'events/ev-1',
  'identityIndex/asha@example.com',
  'paymentRefGuards/412398765432',
  'counters/orderHumanId',
] as const;

/** Paths staff may read. */
const OPEN_TO_STAFF = [
  'inventory/SKU-1',
  'warehouses/blr',
  'reservations/res-1',
  'inventoryLedger/entry-1',
  'analytics/rollups/daily/2026-03-01',
] as const;

/** Paths nobody may read, staff included. */
const CLOSED_TO_EVERYONE = [
  'events/ev-1',
  'identityIndex/asha@example.com',
  'paymentRefGuards/412398765432',
  'counters/orderHumanId',
] as const;

describe('closed to customers', () => {
  for (const path of CLOSED_TO_CUSTOMERS) {
    it(`denies an anonymous read of ${path}`, async () => {
      await assertFails(getDoc(doc(harness.anonymous(), path)));
    });

    it(`denies a customer read of ${path}`, async () => {
      await assertFails(getDoc(doc(harness.customer(), path)));
    });

    it(`denies a customer write to ${path}`, async () => {
      await assertFails(setDoc(doc(harness.customer(), path), { tampered: true }));
    });
  }
});

describe('open to staff', () => {
  for (const path of OPEN_TO_STAFF) {
    it(`allows a staff read of ${path}`, async () => {
      await assertSucceeds(getDoc(doc(harness.staff(), path)));
    });

    it(`allows an owner read of ${path}`, async () => {
      await assertSucceeds(getDoc(doc(harness.owner(), path)));
    });

    it(`denies a staff write to ${path}`, async () => {
      // Rules cannot hold `onHandTotal == sum(stock)` or "available never negative"
      // across documents, so every stock movement goes through a Function transaction
      // that also writes the ledger entry explaining it.
      await assertFails(updateDoc(doc(harness.staff(), path), { tampered: true }));
    });
  }

  it('denies a role we never issue', async () => {
    await assertFails(getDoc(doc(harness.impostor(), 'inventory/SKU-1')));
  });
});

describe('closed to everyone, staff included', () => {
  for (const path of CLOSED_TO_EVERYONE) {
    it(`denies a staff read of ${path}`, async () => {
      await assertFails(getDoc(doc(harness.staff(), path)));
    });

    it(`denies an owner read of ${path}`, async () => {
      await assertFails(getDoc(doc(harness.owner(), path)));
    });

    it(`denies an owner write to ${path}`, async () => {
      await assertFails(setDoc(doc(harness.owner(), path), { tampered: true }));
    });
  }

  it('denies reading identityIndex by an E.164 number', async () => {
    // The enumeration case that matters: a mobile number is a login credential
    // (ADR-0006), so confirming an account exists for one is the first half of a
    // credential attack.
    await assertFails(getDoc(doc(harness.staff(), 'identityIndex/+919845021174')));
  });

  it('denies claiming a payment reference from a client', async () => {
    // The guard document's existence is what makes one UTR unusable twice. A client
    // that could create one could also pre-claim references it does not hold.
    await assertFails(
      setDoc(doc(harness.customer(), 'paymentRefGuards/999999999999'), { orderId: 'own-order' }),
    );
  });

  it('denies advancing the order-number counter from a client', async () => {
    await assertFails(updateDoc(doc(harness.owner(), 'counters/orderHumanId'), { value: 99_999 }));
  });
});

describe('the analytics subtree', () => {
  it('closes every level, not just the leaf', async () => {
    // The rollups are nested (`analytics/rollups/daily/{date}`), so a rule matching only
    // the leaf would leave the parent readable.
    await assertFails(getDoc(doc(harness.customer(), 'analytics/rollups')));
    await assertSucceeds(getDoc(doc(harness.staff(), 'analytics/rollups')));
  });
});

describe('unmatched paths', () => {
  it('denies a collection nobody has written a rule for', async () => {
    // Firestore does not cascade, so this is already the default. Asserted so that the
    // default is a tested property rather than a belief.
    await assertFails(getDoc(doc(harness.staff(), 'someFutureCollection/doc-1')));
    await assertFails(setDoc(doc(harness.owner(), 'someFutureCollection/doc-1'), { a: 1 }));
  });

  it('denies a subcollection under a readable parent', async () => {
    // `products/{id}` is publicly readable, but that says nothing about a subcollection
    // other than `variants`.
    await harness.seed({ 'products/p1': { status: 'active' } });
    await assertFails(getDoc(doc(harness.anonymous(), 'products/p1/secretNotes/n1')));
  });
});
