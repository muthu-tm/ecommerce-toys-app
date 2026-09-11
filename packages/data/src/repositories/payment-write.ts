import { randomUUID } from 'node:crypto';

import type { EventDoc, OrderDoc, OrderEventDoc, PaymentRefGuardDoc } from '@romp/contracts';
import { UtrSchema, orderStatusMachine } from '@romp/contracts';
import {
  DuplicatePaymentReferenceError,
  ReservationExpiredError,
  assertTransition,
  parseOrThrow,
} from '@romp/observability';

import type { Caller, StoreContext } from '../context';
import { actorIdOf, requireOwnership } from '../context';
import { converters } from '../converters';
import { isAlreadyExists } from '../firestore-errors';
import { paths } from '../paths';

import { appendEventInTransaction } from './events';

/**
 * Payment-proof submission — the transaction that claims a UTR.
 *
 * There is no gateway confirming the money moved: the customer pays through their own UPI app and
 * quotes back the transaction reference, which an admin later matches by hand (`SECURITY.md § threat
 * notes`). This is the write that records that claim. It does three things that must commit together
 * or not at all: it stamps the reference and the (optional) proof onto the order, it moves the order
 * into the verification queue, and it **claims the UTR globally** by creating a
 * `paymentRefGuards/{normalisedUtr}` document. That last is the entire mechanism behind
 * `DUPLICATE_PAYMENT_REFERENCE`: the document ID is the normalised reference, so a second order
 * quoting the same UTR fails on the document already existing — a create against a known ID, not a
 * query that could race.
 *
 * The UTR is normalised (uppercased, whitespace stripped) before it is either stored or used as the
 * guard ID, so `1234 5678` and `12345678` are the same claim and cannot both be spent.
 */

/** What the customer submits: the raw reference (server normalises) and an optional proof path. */
export interface SubmitPaymentProofInput {
  readonly orderId: string;
  /** Raw as typed; normalised here. */
  readonly upiRef: string;
  /** Storage path of an uploaded proof image, or null for a reference-only submission. */
  readonly screenshotPath: string | null;
}

export interface SubmitPaymentProofResult {
  readonly orderId: string;
  readonly status: OrderDoc['status'];
  readonly submittedAt: Date;
}

/** Order statuses from which a customer may (re)submit a payment reference. */
const SUBMITTABLE_STATUSES: readonly OrderDoc['status'][] = [
  'awaiting_payment',
  'payment_rejected',
];

/**
 * Records a payment-proof submission against the caller's own order.
 *
 * The order and its reservation are read inside the transaction so ownership and state are decided
 * on the same snapshot the write commits against — a foreign or missing order is an
 * indistinguishable 404 (`requireOwnership`). The order must still be awaiting payment (or have been
 * rejected, the resubmit case), and its reservation must still be `active` and unexpired — a lapsed
 * hold is a `RESERVATION_EXPIRED`, because paying against stock that has been released would confirm
 * an order that can no longer be fulfilled. It then claims the UTR by creating the guard document in
 * the same transaction; a duplicate surfaces as `DUPLICATE_PAYMENT_REFERENCE`. On success the order
 * carries the reference, the proof path, the submitted time and `pending_verification`, and an
 * `order.payment_submitted` event is appended for the audit trail and the notification fan-out.
 */
export async function submitPaymentProof(
  ctx: StoreContext,
  caller: Caller,
  input: SubmitPaymentProofInput,
): Promise<SubmitPaymentProofResult> {
  const now = ctx.clock.now();

  // Normalise before either storing the reference or using it as the guard ID, so a spacing variant
  // cannot bypass the global-uniqueness guard.
  const normalisedUtr = parseOrThrow(
    UtrSchema,
    input.upiRef,
    'That payment reference is not valid.',
  );

  const orderRef = ctx.db.doc(paths.order(input.orderId)).withConverter(converters.orders);
  const guardRef = ctx.db
    .doc(paths.paymentRefGuard(normalisedUtr))
    .withConverter(converters.paymentRefGuards);

  try {
    return await ctx.db.runTransaction(async (tx) => {
      // Ownership and state on one snapshot: a foreign or missing order is a 404.
      const order = requireOwnership(
        caller,
        (await tx.get(orderRef)).data() ?? null,
        (candidate) => candidate.userId,
        { resource: 'order', id: input.orderId },
      );

      if (!SUBMITTABLE_STATUSES.includes(order.status)) {
        // e.g. already pending_verification, paid, cancelled or expired.
        assertTransition(orderStatusMachine, order.status, 'pending_verification', {
          orderId: input.orderId,
        });
      }

      // The reservation must still be holding stock. `reservationId` is set at placement.
      if (order.reservationId === null) {
        throw new ReservationExpiredError();
      }
      const reservationRef = ctx.db
        .doc(paths.reservation(order.reservationId))
        .withConverter(converters.reservations);
      const reservation = (await tx.get(reservationRef)).data();
      if (reservation?.status !== 'active' || reservation.expiresAt.getTime() <= now.getTime()) {
        throw new ReservationExpiredError();
      }

      // Claim the UTR. A pre-read makes an already-committed duplicate deterministic; the create
      // is what makes two *concurrent* claims safe — one commits, the other's create throws
      // ALREADY_EXISTS, caught below.
      if ((await tx.get(guardRef)).exists) {
        throw new DuplicatePaymentReferenceError();
      }

      const guard: PaymentRefGuardDoc = {
        orderId: input.orderId as PaymentRefGuardDoc['orderId'],
        upiRef: normalisedUtr,
        claimedAt: now,
      };

      const nextOrder: OrderDoc = {
        ...order,
        status: 'pending_verification',
        payment: {
          ...order.payment,
          upiRef: normalisedUtr,
          screenshotPath: input.screenshotPath,
          submittedAt: now,
          // A resubmission after a rejection clears the prior rejection so the record reads as a
          // fresh claim awaiting verification, not a rejected one that also has a new reference.
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
        },
        updatedAt: now,
      };

      const orderEvent: OrderEventDoc = {
        orderId: input.orderId as OrderEventDoc['orderId'],
        type: 'order.payment_submitted',
        actorId: actorIdOf(caller) as OrderEventDoc['actorId'],
        actorRole: 'customer',
        payload: { hasScreenshot: input.screenshotPath !== null },
        at: now,
      };

      const spineEvent: EventDoc = {
        type: 'order.payment_submitted',
        actorId: actorIdOf(caller) as EventDoc['actorId'],
        subject: { kind: 'order', id: input.orderId },
        payload: {
          type: 'order.payment_submitted',
          orderId: input.orderId as never,
          humanId: order.humanId,
          userId: order.userId,
          hasScreenshot: input.screenshotPath !== null,
        },
        at: now,
      };

      tx.create(guardRef, guard);
      tx.set(orderRef, nextOrder);
      tx.set(
        ctx.db
          .doc(paths.orderEvent(input.orderId, randomUUID()))
          .withConverter(converters.orderEvents),
        orderEvent,
      );
      appendEventInTransaction(tx, ctx, spineEvent);

      return { orderId: input.orderId, status: nextOrder.status, submittedAt: now };
    });
  } catch (error) {
    if (isAlreadyExists(error)) throw new DuplicatePaymentReferenceError();
    throw error;
  }
}
