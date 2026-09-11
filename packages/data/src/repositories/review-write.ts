import type {
  EventDoc,
  OrderDoc,
  ProductDoc,
  Rating,
  ReviewDoc,
  ReviewStatus,
} from '@romp/contracts';
import { PUBLIC_REVIEW_STATUS, reviewStatusMachine } from '@romp/contracts';
import { NotFoundError, ValidationFailedError, assertTransition } from '@romp/observability';

import type { Caller, StoreContext } from '../context';
import { actorIdOf, requireOwnership, requireStaff, uidOf } from '../context';
import type { WithId } from '../converter';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

import { findProductById } from './catalogue';
import { appendEventInTransaction } from './events';
import { findReviewSlot } from './orders';

/**
 * Review writes — the API-owned half of the `reviews` collection.
 *
 * Reviews are client-READ and API-WRITTEN (`firestore.rules`): the storefront reads published
 * reviews and an author reads their own in any status directly under the rules, but every write goes
 * through here. Two reasons, both server-only. First, **the verified-purchase badge is a factual
 * claim** — it names the paid order that contains the product, and only the server can read a
 * customer's orders to establish it. Second, **moderation is staff-gated and audited**: a review is
 * `pending` until an operator publishes or rejects it, and each decision records who and when and
 * appends to the event spine, none of which a client write could enforce.
 *
 * The `products.ratingAvg`/`ratingCount` pair is **not** maintained here. It is a projection of the
 * published reviews, owned by the `reviews/{id}` Firestore trigger (`apps/api` functions), so that a
 * single writer keeps it true across every path a review's status can change — publish, reject, or a
 * later re-moderation — rather than each write path remembering to touch the product.
 */

/** The fields a customer supplies for a new review. */
export interface ReviewInput {
  readonly productId: string;
  readonly rating: Rating;
  readonly title: string;
  readonly body: string;
}

/**
 * Submits a review for the caller, held `pending` for moderation.
 *
 * In order: confirms the caller is the account, confirms the product exists and is visible (a review
 * of a draft or missing product is a 404), refuses a second review while one already occupies the
 * slot for this product, derives the verified-purchase evidence by reading the caller's own paid
 * orders, snapshots the author's display name, and writes the `pending` review while appending a
 * `review.submitted` event in the same transaction — so the moderation queue sees it the moment it
 * lands. Returns the new review's ID.
 *
 * The body is stored **raw**. React escapes on render and nothing here reaches
 * `dangerouslySetInnerHTML`, so sanitising on write would only mangle the customer's words while
 * adding no protection — the render path is where escaping belongs and where it happens.
 */
export async function submitReview(
  ctx: StoreContext,
  caller: Caller,
  uid: string,
  input: ReviewInput,
  authorName: string,
): Promise<{ readonly id: string }> {
  assertOwnAccount(caller, uid);
  const now = ctx.clock.now();

  const product = await findProductById(ctx, caller, input.productId);
  if (product === null) {
    throw new NotFoundError({ context: { resource: 'product', id: input.productId } });
  }

  const existing = await findReviewSlot(ctx, caller, uid, input.productId);
  if (existing !== null) {
    // One review per customer per product while it is pending or published. A rejected review does
    // not occupy the slot, so a customer whose review was rejected may write another.
    throw new ValidationFailedError([
      { path: 'productId', message: 'You have already reviewed this product.' },
    ]);
  }

  const evidence = await findPurchaseEvidence(ctx, uid, input.productId);

  const collection = ctx.db.collection(COLLECTIONS.reviews).withConverter(converters.reviews);
  const newRef = collection.doc();

  return ctx.db.runTransaction((tx) => {
    // Synchronous body: the ID is pre-allocated (`collection.doc()`), so the review write and the
    // event append need no read, only atomic staging. Wrapped in a resolved promise for the
    // transaction runner's signature.
    const review: ReviewDoc = {
      productId: input.productId as ReviewDoc['productId'],
      userId: uid as ReviewDoc['userId'],
      authorName,
      rating: input.rating,
      title: input.title,
      body: input.body,
      status: 'pending',
      verifiedPurchase: evidence !== null,
      orderId: evidence,
      moderatedBy: null,
      moderatedAt: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(newRef, review);

    const event: EventDoc = {
      type: 'review.submitted',
      actorId: actorIdOf(caller) as EventDoc['actorId'],
      subject: { kind: 'review', id: newRef.id },
      payload: {
        type: 'review.submitted',
        reviewId: newRef.id as never,
        productId: input.productId as never,
        userId: uid as never,
      },
      at: now,
    };
    appendEventInTransaction(tx, ctx, event);

    return Promise.resolve({ id: newRef.id });
  });
}

/** A moderation decision: publish a pending (or re-moderate a rejected) review, or reject one. */
export type ModerationDecision =
  { readonly action: 'publish' } | { readonly action: 'reject'; readonly reason: string };

/**
 * Moderates a review — the staff-gated half.
 *
 * Publishing moves the review to `published` and stamps the moderator and time; rejecting moves it to
 * `rejected` with a reason recorded for the audit but never shown to the author. The legal moves are
 * the review state machine's, so an already-rejected review cannot be rejected again and a published
 * review can be pulled back for re-moderation without deleting the author's words. Each decision
 * appends its event to the spine in the same transaction: `review.published` (which routes a
 * notification to the customer) or `review.rejected` (which deliberately notifies no one).
 *
 * The rating aggregate is untouched here — the trigger reacts to the status change this write makes.
 */
export async function moderateReview(
  ctx: StoreContext,
  caller: Caller,
  reviewId: string,
  decision: ModerationDecision,
): Promise<void> {
  requireStaff(caller, { resource: 'reviews' });
  const now = ctx.clock.now();
  const moderatorId = uidOf(caller);

  const product = await productSlugFor(ctx, caller, reviewId);
  const ref = ctx.db.doc(paths.review(reviewId)).withConverter(converters.reviews);

  await ctx.db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (current === undefined) {
      throw new NotFoundError({ context: { resource: 'review', id: reviewId } });
    }

    const target: ReviewStatus = decision.action === 'publish' ? PUBLIC_REVIEW_STATUS : 'rejected';
    assertTransition(reviewStatusMachine, current.status, target, { reviewId });

    const next: ReviewDoc = {
      ...current,
      status: target,
      moderatedBy: moderatorId as ReviewDoc['moderatedBy'],
      moderatedAt: now,
      rejectionReason: decision.action === 'reject' ? decision.reason : null,
      updatedAt: now,
    };
    tx.set(ref, next);

    const event: EventDoc =
      decision.action === 'publish'
        ? {
            type: 'review.published',
            actorId: actorIdOf(caller) as EventDoc['actorId'],
            subject: { kind: 'review', id: reviewId },
            payload: {
              type: 'review.published',
              reviewId: reviewId as never,
              productId: current.productId,
              productSlug: product.slug,
              userId: current.userId,
            },
            at: now,
          }
        : {
            type: 'review.rejected',
            actorId: actorIdOf(caller) as EventDoc['actorId'],
            subject: { kind: 'review', id: reviewId },
            payload: {
              type: 'review.rejected',
              reviewId: reviewId as never,
              productId: current.productId,
              userId: current.userId,
              reason: decision.reason,
            },
            at: now,
          };
    appendEventInTransaction(tx, ctx, event);
  });
}

/**
 * The order that evidences a verified purchase of this product, or null.
 *
 * A verified purchase is a paid order the caller owns whose line items include the product. Firestore
 * cannot query into the immutable `items` array, so this reads the caller's paid orders and matches
 * in memory — a bounded read (most customers have few paid orders) that returns the first matching
 * order's ID, which `ReviewDocSchema` then holds consistent with the `verifiedPurchase` flag.
 */
async function findPurchaseEvidence(
  ctx: StoreContext,
  uid: string,
  productId: string,
): Promise<ReviewDoc['orderId']> {
  const paidOrders = await runPaidOrdersQuery(ctx, uid);
  for (const order of paidOrders) {
    if (order.items.some((item) => item.productId === productId)) {
      return order.id as ReviewDoc['orderId'];
    }
  }
  return null;
}

/** The caller's paid orders, most recent first — the window a verified-purchase check scans. */
async function runPaidOrdersQuery(
  ctx: StoreContext,
  uid: string,
): Promise<readonly WithId<OrderDoc>[]> {
  const snapshot = await ctx.db
    .collection(COLLECTIONS.orders)
    .withConverter(converters.orders)
    .where('userId', '==', uid)
    .where('status', '==', 'paid')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
}

/** The product a review is for, so `review.published` can carry the slug its notification deep-links to. */
async function productSlugFor(
  ctx: StoreContext,
  caller: Caller,
  reviewId: string,
): Promise<WithId<ProductDoc>> {
  const snapshot = await ctx.db.doc(paths.review(reviewId)).withConverter(converters.reviews).get();
  const review = snapshot.data();
  if (review === undefined) {
    throw new NotFoundError({ context: { resource: 'review', id: reviewId } });
  }
  const product = await findProductById(ctx, caller, review.productId);
  if (product === null) {
    throw new NotFoundError({ context: { resource: 'product', id: review.productId } });
  }
  return product;
}

/**
 * The caller may only submit reviews for their own account.
 *
 * The owner passes on the early-return; anyone else is funnelled through `requireOwnership`, which is
 * a 404 rather than a 403 for the same enumeration reason as everywhere else.
 */
function assertOwnAccount(caller: Caller, uid: string): void {
  if (uidOf(caller) === uid) return;
  requireOwnership(caller, null, () => uid, { resource: 'account', id: uid });
}
