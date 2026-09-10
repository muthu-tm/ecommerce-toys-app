import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { createRulesHarness, CUSTOMER_UID } from '../helpers/rules-env';
import type { RulesHarness } from '../helpers/rules-env';

/**
 * Read matrix — public catalogue rows.
 *
 * | Collection                 | Public                      | Owner              | Staff  |
 * | -------------------------- | --------------------------- | ------------------ | ------ |
 * | products                   | yes, when status == 'active' | yes               | all    |
 * | products/{id}/variants     | yes, when parent is active   | yes               | all    |
 * | categories                 | yes, all                     | yes               | all    |
 * | reviews                    | yes, when status=='published' | own, any status  | all    |
 * | settings/checkout          | yes                          | —                 | all    |
 *
 * Every row has an allow-case and a deny-case below.
 */

let harness: RulesHarness;

const ACTIVE_PRODUCT = 'products/active-product';
const DRAFT_PRODUCT = 'products/draft-product';
const ARCHIVED_PRODUCT = 'products/archived-product';
const ACTIVE_VARIANT = `${ACTIVE_PRODUCT}/variants/SKU-ACTIVE`;
const DRAFT_VARIANT = `${DRAFT_PRODUCT}/variants/SKU-DRAFT`;

beforeAll(async () => {
  harness = await createRulesHarness();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.env.clearFirestore();
  await harness.seed({
    [ACTIVE_PRODUCT]: { slug: 'active-product', status: 'active', name: 'Visible' },
    [DRAFT_PRODUCT]: { slug: 'draft-product', status: 'draft', name: 'Work in progress' },
    [ARCHIVED_PRODUCT]: { slug: 'archived-product', status: 'archived', name: 'Last season' },
    [ACTIVE_VARIANT]: { sku: 'SKU-ACTIVE', productId: 'active-product', active: true },
    [DRAFT_VARIANT]: { sku: 'SKU-DRAFT', productId: 'draft-product', active: true },
    'categories/wooden': { slug: 'wooden', name: 'Wooden toys', showInNav: true },
    'reviews/published-review': { status: 'published', userId: 'someone-else', rating: 5 },
    'reviews/pending-review': { status: 'pending', userId: CUSTOMER_UID, rating: 4 },
    'reviews/rejected-review': { status: 'rejected', userId: CUSTOMER_UID, rating: 1 },
    'reviews/other-pending': { status: 'pending', userId: 'someone-else', rating: 2 },
    'settings/checkout': { reservationTtlMinutes: 30, gstRateBasisPoints: 1800 },
    'settings/internal': { secretish: 'staff only' },
  });
});

describe('products', () => {
  it('allows anyone to read an active product', async () => {
    await assertSucceeds(getDoc(doc(harness.anonymous(), ACTIVE_PRODUCT)));
  });

  it('denies anyone reading a draft product', async () => {
    // A draft is work in progress. Readable, it is reachable by anyone who guesses a
    // slug, and the whole point of a draft is that nobody has approved it yet.
    await assertFails(getDoc(doc(harness.anonymous(), DRAFT_PRODUCT)));
    await assertFails(getDoc(doc(harness.customer(), DRAFT_PRODUCT)));
  });

  it('denies reading an archived product', async () => {
    await assertFails(getDoc(doc(harness.anonymous(), ARCHIVED_PRODUCT)));
  });

  it('allows staff to read every status', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), DRAFT_PRODUCT)));
    await assertSucceeds(getDoc(doc(harness.staff(), ARCHIVED_PRODUCT)));
  });

  it('allows an owner to read every status', async () => {
    await assertSucceeds(getDoc(doc(harness.owner(), DRAFT_PRODUCT)));
  });

  it('denies a caller holding a role we never issue', async () => {
    // The staff check is an allowlist, and an allowlist is only demonstrably one if
    // something outside it is refused.
    await assertFails(getDoc(doc(harness.impostor(), DRAFT_PRODUCT)));
  });

  it('denies every client write, including staff', async () => {
    // Catalogue writes go through the API, which maintains `variantSummary`,
    // `priceFromMinor`, `searchTokens` and the category facet counts in the same
    // transaction. A direct write would leave all four stale.
    await assertFails(setDoc(doc(harness.staff(), 'products/new'), { status: 'active' }));
    await assertFails(updateDoc(doc(harness.staff(), ACTIVE_PRODUCT), { name: 'Renamed' }));
    await assertFails(deleteDoc(doc(harness.owner(), ACTIVE_PRODUCT)));
  });
});

describe('variants', () => {
  it('allows anyone to read a variant of an active product', async () => {
    await assertSucceeds(getDoc(doc(harness.anonymous(), ACTIVE_VARIANT)));
  });

  it('denies reading a variant of a draft product', async () => {
    // The variant document has no status of its own, so without the parent lookup a
    // draft product's pricing would be readable by anyone who guessed the SKU.
    await assertFails(getDoc(doc(harness.anonymous(), DRAFT_VARIANT)));
  });

  it('allows staff to read a variant of a draft product', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), DRAFT_VARIANT)));
  });

  it('denies client writes to variants', async () => {
    await assertFails(updateDoc(doc(harness.staff(), ACTIVE_VARIANT), { priceMinor: 1 }));
  });
});

describe('categories', () => {
  it('allows anyone to read a category', async () => {
    // Navigation metadata, on every page of the storefront. Nothing here is
    // commercially sensitive, so it is not gated.
    await assertSucceeds(getDoc(doc(harness.anonymous(), 'categories/wooden')));
  });

  it('denies client writes', async () => {
    // `productCount` is the facet count, maintained by the product-write Function.
    await assertFails(updateDoc(doc(harness.staff(), 'categories/wooden'), { productCount: 99 }));
  });
});

describe('reviews', () => {
  it('allows anyone to read a published review', async () => {
    await assertSucceeds(getDoc(doc(harness.anonymous(), 'reviews/published-review')));
  });

  it('denies anyone reading a pending review they did not write', async () => {
    await assertFails(getDoc(doc(harness.anonymous(), 'reviews/other-pending')));
    await assertFails(getDoc(doc(harness.customer(), 'reviews/other-pending')));
  });

  it('allows an author to read their own pending review', async () => {
    // So they can tell it was received, rather than concluding the form is broken.
    await assertSucceeds(getDoc(doc(harness.customer(), 'reviews/pending-review')));
  });

  it('allows an author to read their own rejected review', async () => {
    // The review is readable; the rejection *reason* is never rendered to them.
    await assertSucceeds(getDoc(doc(harness.customer(), 'reviews/rejected-review')));
  });

  it('allows staff to read reviews in any status', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), 'reviews/other-pending')));
  });

  it('denies a client writing a review directly', async () => {
    // Submission goes through the API, which checks the one-review-per-product slot
    // and derives `verifiedPurchase` from a paid order.
    await assertFails(
      setDoc(doc(harness.customer(), 'reviews/forged'), {
        userId: CUSTOMER_UID,
        status: 'published',
        rating: 5,
      }),
    );
  });

  it('denies an author changing their own review status to published', async () => {
    // The single most valuable deny-case in this file: self-moderation.
    await assertFails(
      updateDoc(doc(harness.customer(), 'reviews/pending-review'), { status: 'published' }),
    );
  });
});

describe('settings', () => {
  it('allows anyone to read checkout settings', async () => {
    // Every value is shown to the customer before they pay, including the UPI VPA —
    // a payee address, not a secret.
    await assertSucceeds(getDoc(doc(harness.anonymous(), 'settings/checkout')));
  });

  it('denies a customer reading any other settings document', async () => {
    // Opening the collection wholesale would make the next settings document public
    // by default.
    await assertFails(getDoc(doc(harness.anonymous(), 'settings/internal')));
    await assertFails(getDoc(doc(harness.customer(), 'settings/internal')));
  });

  it('allows staff to read any settings document', async () => {
    await assertSucceeds(getDoc(doc(harness.staff(), 'settings/internal')));
  });

  it('denies a client editing checkout settings', async () => {
    // Owners edit these through the API, which validates and writes an audit event.
    // A direct write would let a compromised session change the payee VPA.
    await assertFails(
      updateDoc(doc(harness.owner(), 'settings/checkout'), { upi: { vpa: 'attacker@bank' } }),
    );
  });
});
