import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { CUSTOMER_UID, OTHER_CUSTOMER_UID, createRulesHarness } from '../helpers/rules-env';
import type { RulesHarness } from '../helpers/rules-env';

/**
 * Read matrix — user-scoped rows.
 *
 * | Collection                       | Public | Owner   | Staff |
 * | -------------------------------- | ------ | ------- | ----- |
 * | users/{uid} and subcollections   | no     | yes self | yes  |
 * | carts                            | no     | yes own  | yes  |
 * | orders                           | no     | yes own  | yes  |
 * | orders/{id}/events               | no     | yes own  | yes  |
 * | refunds                          | no     | yes own  | yes  |
 *
 * Note what a "deny" means here. Rules cannot distinguish "not yours" from "does not
 * exist", and that is the behaviour the design wants: a 403 confirms the resource
 * exists, which is itself a disclosure (`SECURITY.md` § 2 — 404, not 403).
 *
 * Every one of these is client-READ and API-WRITTEN. The read path is open so account
 * pages render without an API round trip; the write path is closed so ownership
 * invariants — one default address, a cart priced by the server — cannot be bypassed.
 */

let harness: RulesHarness;

const OWN_ORDER = 'orders/own-order';
const OTHER_ORDER = 'orders/other-order';

beforeAll(async () => {
  harness = await createRulesHarness();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.env.clearFirestore();
  await harness.seed({
    [`users/${CUSTOMER_UID}`]: { displayName: 'Asha', primaryIdentifierType: 'email' },
    [`users/${OTHER_CUSTOMER_UID}`]: { displayName: 'Ravi', primaryIdentifierType: 'phone' },
    [`users/${CUSTOMER_UID}/addresses/home`]: { label: 'Home', isDefault: true },
    [`users/${OTHER_CUSTOMER_UID}/addresses/home`]: { label: 'Home', isDefault: true },
    [`users/${CUSTOMER_UID}/wishlist/some-product`]: { productId: 'some-product' },
    [`users/${OTHER_CUSTOMER_UID}/wishlist/some-product`]: { productId: 'some-product' },

    [`carts/${CUSTOMER_UID}`]: { ownerType: 'user', userId: CUSTOMER_UID, items: [] },
    [`carts/${OTHER_CUSTOMER_UID}`]: {
      ownerType: 'user',
      userId: OTHER_CUSTOMER_UID,
      items: [],
    },
    // An anonymous cart keyed by a cookie ID. Anonymous auth is disabled, so no client
    // can ever be its owner — it is server-only by construction.
    'carts/anon-cookie-id': { ownerType: 'anonymous', userId: null, items: [] },
    // A cart whose document ID matches a customer's uid but whose stored owner is
    // someone else. The rule checks the field, not the path.
    [`carts/${CUSTOMER_UID}-lookalike`]: {
      ownerType: 'user',
      userId: OTHER_CUSTOMER_UID,
      items: [],
    },

    [OWN_ORDER]: { userId: CUSTOMER_UID, humanId: 'RMP-1001', status: 'awaiting_payment' },
    [OTHER_ORDER]: { userId: OTHER_CUSTOMER_UID, humanId: 'RMP-1002', status: 'paid' },
    [`${OWN_ORDER}/events/ev-1`]: { type: 'order.created', actorRole: 'customer' },
    [`${OTHER_ORDER}/events/ev-1`]: { type: 'order.created', actorRole: 'customer' },

    'refunds/own-refund': { orderId: 'own-order', userId: CUSTOMER_UID, amountMinor: 100 },
    'refunds/other-refund': {
      orderId: 'other-order',
      userId: OTHER_CUSTOMER_UID,
      amountMinor: 100,
    },
  });
});

describe('users', () => {
  it('allows a customer to read their own record', async () => {
    await assertSucceeds(getDoc(doc(harness.customer(), `users/${CUSTOMER_UID}`)));
  });

  it('denies a customer reading another account', async () => {
    // The record holds an email and an E.164 mobile number, and for a mobile-only
    // account that number is the login credential (ADR-0006).
    await assertFails(getDoc(doc(harness.customer(), `users/${OTHER_CUSTOMER_UID}`)));
  });

  it('denies an unauthenticated read', async () => {
    await assertFails(getDoc(doc(harness.anonymous(), `users/${CUSTOMER_UID}`)));
  });

  it('allows staff to read any account', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), `users/${CUSTOMER_UID}`)));
  });

  it('denies a customer writing their own record', async () => {
    // `orderCount` and `lifetimeValueMinor` are maintained by the payment-verified
    // transaction. A client write would let a customer claim a loyalty tier.
    await assertFails(
      updateDoc(doc(harness.customer(), `users/${CUSTOMER_UID}`), { orderCount: 999 }),
    );
  });

  it('denies staff writing an account record', async () => {
    await assertFails(
      updateDoc(doc(harness.staff(), `users/${CUSTOMER_UID}`), { displayName: 'Edited' }),
    );
  });
});

describe('addresses', () => {
  it('allows a customer to read their own addresses', async () => {
    await assertSucceeds(getDoc(doc(harness.customer(), `users/${CUSTOMER_UID}/addresses/home`)));
  });

  it('denies reading another customer addresses', async () => {
    await assertFails(
      getDoc(doc(harness.customer(), `users/${OTHER_CUSTOMER_UID}/addresses/home`)),
    );
  });

  it('allows staff to read addresses, for fulfilment', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), `users/${CUSTOMER_UID}/addresses/home`)));
  });

  it('denies a customer creating an address directly', async () => {
    // "Exactly one default address per user" spans sibling documents, so rules cannot
    // enforce it. The API transaction can.
    await assertFails(
      setDoc(doc(harness.customer(), `users/${CUSTOMER_UID}/addresses/new`), {
        label: 'Office',
        isDefault: true,
      }),
    );
  });

  it('denies a customer deleting an address', async () => {
    await assertFails(deleteDoc(doc(harness.customer(), `users/${CUSTOMER_UID}/addresses/home`)));
  });
});

describe('wishlist', () => {
  it('allows a customer to read their own wishlist', async () => {
    await assertSucceeds(
      getDoc(doc(harness.customer(), `users/${CUSTOMER_UID}/wishlist/some-product`)),
    );
  });

  it('denies reading another customer wishlist', async () => {
    await assertFails(
      getDoc(doc(harness.customer(), `users/${OTHER_CUSTOMER_UID}/wishlist/some-product`)),
    );
  });

  it('denies a client toggling a wishlist entry directly', async () => {
    // The API checks the product exists and is active, so a wishlist cannot accumulate
    // references to nothing.
    await assertFails(
      setDoc(doc(harness.customer(), `users/${CUSTOMER_UID}/wishlist/another`), {
        productId: 'another',
      }),
    );
  });
});

describe('carts', () => {
  it('allows a customer to read their own cart', async () => {
    await assertSucceeds(getDoc(doc(harness.customer(), `carts/${CUSTOMER_UID}`)));
  });

  it('denies reading another customer cart', async () => {
    await assertFails(getDoc(doc(harness.customer(), `carts/${OTHER_CUSTOMER_UID}`)));
  });

  it('checks the stored owner, not the document ID', async () => {
    // A cart named after a customer but owned by someone else must not be readable, or
    // the rule would be a naming convention rather than a check.
    await assertFails(getDoc(doc(harness.customer(), `carts/${CUSTOMER_UID}-lookalike`)));
  });

  it('denies any client reading an anonymous cart', async () => {
    // Anonymous auth is disabled, so an anonymous cart has no client that could be its
    // owner. It is reachable only through the API, by cookie.
    await assertFails(getDoc(doc(harness.anonymous(), 'carts/anon-cookie-id')));
    await assertFails(getDoc(doc(harness.customer(), 'carts/anon-cookie-id')));
  });

  it('allows staff to read a cart, including an anonymous one', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), 'carts/anon-cookie-id')));
  });

  it('denies a customer writing their own cart', async () => {
    // The sharpest write-deny in the ruleset: a client-written cart lets the browser
    // choose the price. Availability, price refresh and quantity ceilings all run
    // server-side.
    await assertFails(
      updateDoc(doc(harness.customer(), `carts/${CUSTOMER_UID}`), {
        items: [{ variantId: 'SKU-1', qty: 1, priceMinorSnapshot: 1 }],
      }),
    );
  });

  it('denies a customer creating a cart', async () => {
    await assertFails(
      setDoc(doc(harness.customer(), 'carts/invented'), {
        ownerType: 'user',
        userId: CUSTOMER_UID,
        items: [],
      }),
    );
  });
});

describe('orders', () => {
  it('allows a customer to read their own order', async () => {
    await assertSucceeds(getDoc(doc(harness.customer(), OWN_ORDER)));
  });

  it('denies reading another customer order', async () => {
    // Orders carry a shipping address, a contact phone number and a payment reference.
    await assertFails(getDoc(doc(harness.customer(), OTHER_ORDER)));
  });

  it('denies an unauthenticated read', async () => {
    await assertFails(getDoc(doc(harness.anonymous(), OWN_ORDER)));
  });

  it('allows staff to read any order', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), OTHER_ORDER)));
  });

  it('denies a customer marking their own order paid', async () => {
    // The whole manual-payment control: reaching `paid` requires an admin actor
    // recorded in `payment.verifiedBy`, written by a Function.
    await assertFails(updateDoc(doc(harness.customer(), OWN_ORDER), { status: 'paid' }));
  });

  it('denies staff marking an order paid directly', async () => {
    // Even staff go through the API, because verification writes an immutable audit
    // event in the same transaction.
    await assertFails(updateDoc(doc(harness.staff(), OTHER_ORDER), { status: 'paid' }));
  });

  it('denies a customer cancelling by deletion', async () => {
    await assertFails(deleteDoc(doc(harness.customer(), OWN_ORDER)));
  });
});

describe('per-order events', () => {
  it('allows a customer to read the audit trail of their own order', async () => {
    await assertSucceeds(getDoc(doc(harness.customer(), `${OWN_ORDER}/events/ev-1`)));
  });

  it('denies reading the audit trail of another customer order', async () => {
    await assertFails(getDoc(doc(harness.customer(), `${OTHER_ORDER}/events/ev-1`)));
  });

  it('allows staff to read any order audit trail', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), `${OTHER_ORDER}/events/ev-1`)));
  });

  it('denies appending to the audit trail from a client', async () => {
    // Append-only means append-only *by the system*. A client-written entry would make
    // "who marked this paid" forgeable.
    await assertFails(
      setDoc(doc(harness.customer(), `${OWN_ORDER}/events/forged`), {
        type: 'order.payment_verified',
        actorRole: 'staff',
      }),
    );
  });
});

describe('refunds', () => {
  it('allows a customer to read their own refund', async () => {
    await assertSucceeds(getDoc(doc(harness.customer(), 'refunds/own-refund')));
  });

  it('denies reading another customer refund', async () => {
    await assertFails(getDoc(doc(harness.customer(), 'refunds/other-refund')));
  });

  it('allows staff to read any refund', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), 'refunds/other-refund')));
  });

  it('denies a client creating a refund', async () => {
    // Refunds move money outward and require the `owner` claim through the API. A
    // client-created refund record would be an instruction to pay.
    await assertFails(
      setDoc(doc(harness.customer(), 'refunds/forged'), {
        orderId: 'own-order',
        userId: CUSTOMER_UID,
        amountMinor: 500_000,
      }),
    );
    await assertFails(
      setDoc(doc(harness.owner(), 'refunds/forged'), {
        orderId: 'own-order',
        userId: CUSTOMER_UID,
        amountMinor: 500_000,
      }),
    );
  });
});
