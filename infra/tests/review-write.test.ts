import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OrderDoc, ProductDoc, Rating } from '@romp/contracts';
import { RatingSchema } from '@romp/contracts';
import { anOrder, aProduct } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  applyReviewRatingChange,
  asCustomer,
  asOperator,
  converters,
  createStoreContext,
  listModerationQueue,
  listOwnReviews,
  listPublishedReviews,
  moderateReview,
  submitReview,
  systemClock,
} from '@romp/data';
import { InvalidStateTransitionError, ValidationFailedError } from '@romp/observability';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * Review writes against real Firestore.
 *
 * The unit tests cover the branch logic; this proves it end to end against the converters and the
 * real queries: a submit lands `pending` with the verified-purchase badge derived from a real paid
 * order, the moderation queue and the customer's own-reviews read see it, publishing makes it
 * publicly visible and appends `review.published`, and the one-review-per-product slot holds.
 */

let app: App;
let ctx: StoreContext;

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `review-write-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const STAFF = asOperator('staff-review-1', 'staff');
const rating = (n: number): Rating => RatingSchema.parse(n);

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

async function seedProduct(): Promise<string> {
  const slug = uniqueId('prod');
  await ctx.db
    .doc(`products/${slug}`)
    .withConverter(converters.products)
    .set(aProduct({ slug: slug as ProductDoc['slug'], status: 'active' }));
  return slug;
}

async function seedPaidOrder(uid: string, productId: string): Promise<string> {
  const id = uniqueId('order');
  const base = anOrder();
  const order = anOrder({
    userId: uid as OrderDoc['userId'],
    status: 'paid',
    payment: {
      ...base.payment,
      verifiedBy: 'staff-review-1' as never,
      verifiedAt: systemClock.now(),
    },
    items: [{ ...base.items[0]!, productId: productId as never }],
  });
  await ctx.db.doc(`orders/${id}`).withConverter(converters.orders).set(order);
  return id;
}

const reviewInput = (productId: string) => ({
  productId,
  rating: rating(4),
  title: 'Sturdy and well made',
  body: 'Held up to a month of daily play with no splinters.',
});

describe('review writes against Firestore', () => {
  it('submits a pending review with a verified-purchase badge and the right event', async () => {
    const uid = uniqueId('cust');
    const caller = asCustomer(uid);
    const productId = await seedProduct();
    await seedPaidOrder(uid, productId);

    const { id } = await submitReview(ctx, caller, uid, reviewInput(productId), 'Asha M.');

    // The author sees their own pending review; the public sees nothing yet.
    const own = await listOwnReviews(ctx, caller, uid);
    expect(own.find((r) => r.id === id)?.status).toBe('pending');
    expect(own.find((r) => r.id === id)?.verifiedPurchase).toBe(true);
    expect(await listPublishedReviews(ctx, productId)).toHaveLength(0);

    // It appears in the moderation queue.
    const queue = await listModerationQueue(ctx, STAFF);
    expect(queue.some((r) => r.id === id)).toBe(true);

    // A review.submitted event landed on the spine.
    const events = await ctx.db
      .collection('events')
      .where('type', '==', 'review.submitted')
      .where('subject.id', '==', id)
      .get();
    expect(events.empty).toBe(false);
  });

  it('leaves the badge off with no matching purchase', async () => {
    const uid = uniqueId('cust');
    const caller = asCustomer(uid);
    const productId = await seedProduct();

    const { id } = await submitReview(ctx, caller, uid, reviewInput(productId), 'Ravi K.');
    const own = await listOwnReviews(ctx, caller, uid);
    const review = own.find((r) => r.id === id);
    expect(review?.verifiedPurchase).toBe(false);
    expect(review?.orderId).toBeNull();
  });

  it('publishes a review so the public can read it', async () => {
    const uid = uniqueId('cust');
    const caller = asCustomer(uid);
    const productId = await seedProduct();

    const { id } = await submitReview(ctx, caller, uid, reviewInput(productId), 'Meera P.');
    await moderateReview(ctx, STAFF, id, { action: 'publish' });

    const published = await listPublishedReviews(ctx, productId);
    expect(published.some((r) => r.id === id)).toBe(true);

    const events = await ctx.db
      .collection('events')
      .where('type', '==', 'review.published')
      .where('subject.id', '==', id)
      .get();
    expect(events.empty).toBe(false);
  });

  it('rejects a review, which never appears publicly', async () => {
    const uid = uniqueId('cust');
    const caller = asCustomer(uid);
    const productId = await seedProduct();

    const { id } = await submitReview(ctx, caller, uid, reviewInput(productId), 'Sam T.');
    await moderateReview(ctx, STAFF, id, { action: 'reject', reason: 'Contains a spoiler.' });

    expect(await listPublishedReviews(ctx, productId)).toHaveLength(0);
    // A rejected review does not occupy the slot, so a new submission is allowed.
    const second = await submitReview(ctx, caller, uid, reviewInput(productId), 'Sam T.');
    expect(second.id).not.toBe(id);
  });

  it('refuses a second review while one occupies the slot', async () => {
    const uid = uniqueId('cust');
    const caller = asCustomer(uid);
    const productId = await seedProduct();

    await submitReview(ctx, caller, uid, reviewInput(productId), 'Nina R.');
    await expect(
      submitReview(ctx, caller, uid, reviewInput(productId), 'Nina R.'),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('refuses an illegal moderation transition', async () => {
    const uid = uniqueId('cust');
    const caller = asCustomer(uid);
    const productId = await seedProduct();

    const { id } = await submitReview(ctx, caller, uid, reviewInput(productId), 'Dev S.');
    await moderateReview(ctx, STAFF, id, { action: 'reject', reason: 'Off-topic.' });
    // rejected is terminal — a second rejection is refused.
    await expect(
      moderateReview(ctx, STAFF, id, { action: 'reject', reason: 'again' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('maintains the product rating aggregate across publish and un-publish', async () => {
    // The trigger body (`applyReviewRatingChange`) against real Firestore — the emulator harness
    // does not run the Functions trigger itself, so its body is exercised directly.
    const productId = uniqueId('prod');
    await ctx.db
      .doc(`products/${productId}`)
      .withConverter(converters.products)
      // A product with no reviews yet: the pair the aggregate starts from.
      .set(
        aProduct({
          slug: productId as ProductDoc['slug'],
          status: 'active',
          ratingCount: 0,
          ratingAvg: 0,
        }),
      );
    const readAggregate = async (): Promise<{ ratingAvg: number; ratingCount: number }> => {
      const snap = await ctx.db
        .doc(`products/${productId}`)
        .withConverter(converters.products)
        .get();
      const product = snap.data();
      return { ratingAvg: product?.ratingAvg ?? -1, ratingCount: product?.ratingCount ?? -1 };
    };

    // A fresh product starts at zero.
    const zeroed = { counted: false, rating: 0 };
    await applyReviewRatingChange(ctx, productId, null, zeroed); // no-op submit
    let agg = await readAggregate();
    expect(agg.ratingCount).toBe(0);

    // Publishing a 4-star review: +1 at 4.0.
    await applyReviewRatingChange(ctx, productId, zeroed, { counted: true, rating: 4 });
    agg = await readAggregate();
    expect(agg).toEqual({ ratingCount: 1, ratingAvg: 4 });

    // Publishing a 5-star review: 2 reviews, average 4.5.
    await applyReviewRatingChange(ctx, productId, null, { counted: true, rating: 5 });
    agg = await readAggregate();
    expect(agg).toEqual({ ratingCount: 2, ratingAvg: 4.5 });

    // Un-publishing the 4-star review (rejected): back to 1 at 5.0.
    await applyReviewRatingChange(
      ctx,
      productId,
      { counted: true, rating: 4 },
      { counted: false, rating: 4 },
    );
    agg = await readAggregate();
    expect(agg).toEqual({ ratingCount: 1, ratingAvg: 5 });

    // Un-publishing the last one: back to zero, average 0.
    await applyReviewRatingChange(ctx, productId, { counted: true, rating: 5 }, null);
    agg = await readAggregate();
    expect(agg).toEqual({ ratingCount: 0, ratingAvg: 0 });
  });
});
