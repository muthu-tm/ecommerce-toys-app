import { randomUUID } from 'node:crypto';

import type {
  EventDoc,
  FulfilmentStatus,
  OrderDoc,
  OrderEventDoc,
  OrderFulfilment,
} from '@romp/contracts';
import { fulfilmentStatusMachine } from '@romp/contracts';
import { InvalidStateTransitionError, NotFoundError, assertTransition } from '@romp/observability';

import type { Caller, StoreContext } from '../context';
import { actorIdOf, requireStaff } from '../context';
import { converters } from '../converters';
import { paths } from '../paths';

import { appendEventInTransaction } from './events';

/**
 * Fulfilment — the operational side of an order, tracked by a machine of its own.
 *
 * Payment and fulfilment are **separate state machines** (`domain/order.ts`), deliberately: a paid
 * order can go on hold, and a delivered order can still be refunded, so collapsing the two would
 * force invented composite states. That separation has one consequence this file has to enforce by
 * hand — the fulfilment machine does not know whether the money arrived, so "you cannot pack an
 * unpaid order" is not an edge it can express. It is a guard here, at the point the two machines
 * meet, rather than a transition in either one.
 *
 * Each advance stamps the timestamp for the stage it reaches and, for the customer-visible ones,
 * appends both a per-order event (the audit trail the customer can read) and a spine event (which
 * the notification dispatcher projects into "your order shipped"). `shipped` additionally carries a
 * carrier and tracking number — the schema refuses a shipped order without them, because the
 * notification copy interpolates both.
 */

/** The operator's fulfilment decision. Fields beyond `status` are required by the target stage. */
export interface AdvanceFulfilmentInput {
  readonly orderId: string;
  readonly status: FulfilmentStatus;
  /** Required when shipping — the schema refuses a shipped order without a carrier and tracking. */
  readonly carrier?: string | null;
  readonly trackingNo?: string | null;
  /** Required when placing on hold — an order on hold records why. */
  readonly holdReason?: string | null;
}

export interface AdvanceFulfilmentResult {
  readonly orderId: string;
  readonly status: FulfilmentStatus;
}

/** Which spine event, if any, a fulfilment stage announces to the customer. */
const FULFILMENT_EVENT: Partial<Record<FulfilmentStatus, EventDoc['type']>> = {
  packed: 'order.packed',
  shipped: 'order.shipped',
  delivered: 'order.delivered',
};

/**
 * Advances an order's fulfilment to the next stage.
 *
 * Staff-gated. In one transaction it reads the order, refuses an illegal fulfilment transition
 * (`assertTransition`), refuses to pack an order whose payment has not settled (the cross-machine
 * guard), stamps the stage's timestamp and any carrier/tracking/hold detail, and — for pack, ship
 * and deliver — appends the per-order and spine events. `on_hold` is an internal operational state
 * with no customer notification, so it moves the status and records the reason without announcing
 * anything.
 */
export async function advanceFulfilment(
  ctx: StoreContext,
  caller: Caller,
  input: AdvanceFulfilmentInput,
): Promise<AdvanceFulfilmentResult> {
  requireStaff(caller, { resource: 'orders' });
  const now = ctx.clock.now();
  const actorId = actorIdOf(caller);

  const orderRef = ctx.db.doc(paths.order(input.orderId)).withConverter(converters.orders);

  return ctx.db.runTransaction(async (tx) => {
    const current = (await tx.get(orderRef)).data();
    if (current === undefined) {
      throw new NotFoundError({ context: { resource: 'order', id: input.orderId } });
    }

    // Legal fulfilment transition, independent of payment.
    assertTransition(fulfilmentStatusMachine, current.fulfilment.status, input.status, {
      orderId: input.orderId,
    });

    // The cross-machine guard: fulfilment cannot begin on an order that has not been paid. The
    // fulfilment machine cannot express this, because it does not know the payment status — so the
    // one edge that leaves `unfulfilled` towards shipping (`packed`) is gated here instead.
    if (input.status === 'packed' && current.status !== 'paid') {
      throw new InvalidStateTransitionError({
        detail: 'An order cannot be packed until its payment is verified.',
        context: { orderId: input.orderId, orderStatus: current.status, reason: 'not_paid' },
      });
    }

    const nextFulfilment = applyFulfilmentFields(current.fulfilment, input, now);

    const nextOrder: OrderDoc = { ...current, fulfilment: nextFulfilment, updatedAt: now };
    tx.set(orderRef, nextOrder);

    const spineType = FULFILMENT_EVENT[input.status];
    if (spineType !== undefined) {
      const orderEvent: OrderEventDoc = {
        orderId: input.orderId as OrderEventDoc['orderId'],
        type: spineType,
        actorId: actorId as OrderEventDoc['actorId'],
        actorRole: 'staff',
        payload:
          spineType === 'order.shipped'
            ? { carrier: nextFulfilment.carrier, trackingNo: nextFulfilment.trackingNo }
            : {},
        at: now,
      };
      tx.set(
        ctx.db
          .doc(paths.orderEvent(input.orderId, randomUUID()))
          .withConverter(converters.orderEvents),
        orderEvent,
      );

      const spineEvent: EventDoc =
        spineType === 'order.shipped'
          ? {
              type: 'order.shipped',
              actorId: actorId as EventDoc['actorId'],
              subject: { kind: 'order', id: input.orderId },
              payload: {
                type: 'order.shipped',
                orderId: input.orderId as never,
                humanId: current.humanId,
                userId: current.userId,
                // Non-null on `shipped`: `applyFulfilmentFields` throws otherwise. `?? ''` satisfies
                // the type; the schema refine guarantees the value is present.
                carrier: nextFulfilment.carrier ?? '',
                trackingNo: nextFulfilment.trackingNo ?? '',
              },
              at: now,
            }
          : {
              type: spineType,
              actorId: actorId as EventDoc['actorId'],
              subject: { kind: 'order', id: input.orderId },
              payload: {
                type: spineType as 'order.packed' | 'order.delivered',
                orderId: input.orderId as never,
                humanId: current.humanId,
                userId: current.userId,
              },
              at: now,
            };
      appendEventInTransaction(tx, ctx, spineEvent);
    }

    return { orderId: input.orderId, status: input.status };
  });
}

/**
 * Applies the target stage's fields to the fulfilment record.
 *
 * Each stage stamps its own timestamp so the fulfilment history reads as a sequence of instants, and
 * carries the detail the schema requires of it: a shipped order records its carrier and tracking, an
 * order on hold records why. Earlier timestamps are preserved — reaching `delivered` does not erase
 * `packedAt` — so the record answers "when was this packed" long after it shipped.
 */
function applyFulfilmentFields(
  current: OrderFulfilment,
  input: AdvanceFulfilmentInput,
  now: Date,
): OrderFulfilment {
  const base: OrderFulfilment = { ...current, status: input.status };

  switch (input.status) {
    case 'packed':
      return { ...base, packedAt: now };
    case 'shipped': {
      const carrier = input.carrier ?? current.carrier;
      const trackingNo = input.trackingNo ?? current.trackingNo;
      if (carrier === null || trackingNo === null) {
        // The schema would reject this on write, but a domain error at the point of decision reads
        // better than a converter shape error, and names what the operator omitted.
        throw new InvalidStateTransitionError({
          detail: 'Shipping an order needs a carrier and a tracking number.',
          context: { orderId: input.orderId, reason: 'missing_tracking' },
        });
      }
      return { ...base, carrier, trackingNo, shippedAt: now };
    }
    case 'delivered':
      return { ...base, deliveredAt: now };
    case 'on_hold': {
      const holdReason = input.holdReason ?? current.holdReason;
      if (holdReason === null) {
        throw new InvalidStateTransitionError({
          detail: 'Placing an order on hold needs a reason.',
          context: { orderId: input.orderId, reason: 'missing_hold_reason' },
        });
      }
      return { ...base, holdReason };
    }
    case 'unfulfilled':
      // Coming back off hold — clear the hold reason so a stale explanation does not linger.
      return { ...base, holdReason: null };
    case 'cancelled':
      // Fulfilment-side cancellation is driven by `cancelOrder`, which owns the release/restock
      // branch and moves both machines together. Reaching it here would move fulfilment without the
      // stock consequences, so it is refused rather than silently half-done.
      throw new InvalidStateTransitionError({
        detail:
          'Cancel an order through the cancel action, which handles stock, not fulfilment alone.',
        context: { orderId: input.orderId, reason: 'use_cancel_action' },
      });
    default:
      return base;
  }
}
