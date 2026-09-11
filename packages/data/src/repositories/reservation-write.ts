import { randomUUID } from 'node:crypto';

import type {
  EventDoc,
  InventoryDoc,
  OrderDoc,
  OrderEventDoc,
  ReservationDoc,
} from '@romp/contracts';
import { orderStatusMachine } from '@romp/contracts';
import { assertTransition } from '@romp/observability';

import type { StoreContext } from '../context';
import { asSystem } from '../context';
import { converters } from '../converters';
import { paths } from '../paths';

import { appendEventInTransaction } from './events';
import { listExpiredReservations } from './inventory';

/**
 * Releasing expired reservations — the second half of the reservation lifecycle.
 *
 * A reservation holds stock by raising `inventory.reserved` (Task 16); it never moves on-hand,
 * because the stock is not gone until the payment is confirmed. So releasing it is the exact inverse:
 * lower `reserved` back, and the held units return to *available* (`available = onHandTotal −
 * reserved`) without on-hand changing. That is why the release writes **no inventory-ledger entry** —
 * the ledger records on-hand movement and reconciles to `inventory.stock` (DATA_MODEL.md), and a
 * hold that never touched on-hand has no on-hand movement to record. The release is audited on the
 * append-only event spine instead: `order.expired`, plus the reservation's own `released`/`resolvedAt`.
 *
 * The whole point is that the sweeper's *non-execution* is the failure: a stalled sweeper throws
 * nothing while leaking stock. So this is written to be safe to run again and again — every release
 * is guarded by the current reservation and order status, so a re-run over an already-released
 * reservation is a no-op, and a concurrent verification that moved the order into
 * `pending_verification` is respected rather than overridden.
 */

/** Why a reservation was not released — for the sweeper's structured logging. */
export type ReleaseSkipReason =
  'reservation_absent' | 'reservation_not_active' | 'order_absent' | 'order_not_holding';

export type ReleaseOutcome =
  { readonly released: true } | { readonly released: false; readonly reason: ReleaseSkipReason };

/** The order statuses whose reservation the sweeper may release. */
const SWEEPABLE_STATUSES: readonly OrderDoc['status'][] = ['awaiting_payment', 'payment_rejected'];

/**
 * Releases one reservation and expires its order, in a single transaction.
 *
 * Reads the reservation, its order and each item's inventory record on one snapshot. It refuses —
 * as a no-op, not an error — when there is nothing to do: the reservation is gone or no longer
 * `active`, or the order is gone or has moved out of a stock-holding, pre-payment state (a customer
 * who submitted proof between the sweep's list and this transaction owns the order now, and
 * `pending_verification → expired` is not a legal transition). Otherwise it lowers each variant's
 * `reserved` by the reserved quantity, marks the reservation `released`, expires the order, and
 * appends the audit events. Lowering `reserved` can never break the oversell invariant, so the
 * inventory write always validates.
 */
export async function releaseReservation(
  ctx: StoreContext,
  reservationId: string,
): Promise<ReleaseOutcome> {
  const now = ctx.clock.now();
  const reservationRef = ctx.db
    .doc(paths.reservation(reservationId))
    .withConverter(converters.reservations);

  return ctx.db.runTransaction(async (tx) => {
    const reservation = (await tx.get(reservationRef)).data();
    if (reservation === undefined) return { released: false, reason: 'reservation_absent' };
    if (reservation.status !== 'active')
      return { released: false, reason: 'reservation_not_active' };

    const orderRef = ctx.db.doc(paths.order(reservation.orderId)).withConverter(converters.orders);
    const order = (await tx.get(orderRef)).data();
    if (order === undefined) return { released: false, reason: 'order_absent' };
    if (!SWEEPABLE_STATUSES.includes(order.status)) {
      // e.g. the customer just submitted proof (pending_verification), or it was already
      // expired/cancelled. Leave the order alone; the reservation is released by the path that
      // moved the order, not by the sweeper.
      return { released: false, reason: 'order_not_holding' };
    }

    // Read every affected inventory record before writing.
    const inventoryReads = await Promise.all(
      reservation.items.map(async (item) => {
        const ref = ctx.db.doc(paths.inventory(item.variantId)).withConverter(converters.inventory);
        return { item, ref, inventory: (await tx.get(ref)).data() };
      }),
    );

    // Legal transition guard — `awaiting_payment`/`payment_rejected` → `expired`.
    assertTransition(orderStatusMachine, order.status, 'expired', { orderId: reservation.orderId });

    // Lower `reserved` by the held quantity per variant. A missing inventory record means the
    // reservation is holding against nothing to lower — skip that line rather than fail the sweep.
    for (const { item, ref, inventory } of inventoryReads) {
      if (inventory === undefined) continue;
      const nextReserved = Math.max(0, inventory.reserved - item.qty);
      const next: InventoryDoc = { ...inventory, reserved: nextReserved, updatedAt: now };
      tx.set(ref, next);
    }

    const nextReservation: ReservationDoc = {
      ...reservation,
      status: 'released',
      resolvedAt: now,
    };
    tx.set(reservationRef, nextReservation);

    const nextOrder: OrderDoc = { ...order, status: 'expired', updatedAt: now };
    tx.set(orderRef, nextOrder);

    const orderEvent: OrderEventDoc = {
      orderId: reservation.orderId,
      type: 'order.expired',
      actorId: 'system',
      actorRole: 'system',
      payload: { humanId: order.humanId },
      at: now,
    };
    tx.set(
      ctx.db
        .doc(paths.orderEvent(reservation.orderId, randomUUID()))
        .withConverter(converters.orderEvents),
      orderEvent,
    );

    const spineEvent: EventDoc = {
      type: 'order.expired',
      actorId: 'system',
      subject: { kind: 'order', id: reservation.orderId },
      payload: {
        type: 'order.expired',
        orderId: reservation.orderId,
        humanId: order.humanId,
        userId: order.userId,
      },
      at: now,
    };
    appendEventInTransaction(tx, ctx, spineEvent);

    return { released: true };
  });
}

/** The result of one sweep pass. */
export interface SweepResult {
  /** Reservations found overdue and still active in this pass. */
  readonly found: number;
  /** Reservations actually released (order expired, stock returned). */
  readonly released: number;
  /** Reservations that were a no-op this pass (already resolved, order moved on). */
  readonly skipped: number;
}

/**
 * Releases every reservation past its expiry that still holds stock.
 *
 * Lists the overdue-and-active reservations (index-backed, oldest first) and releases each in its
 * own transaction, so one contended reservation cannot roll back the rest of the pass and a partial
 * failure still frees everything it reached. Idempotent by construction: `releaseReservation` no-ops
 * anything already resolved, so re-running the sweep — which the scheduler will, at least once — is
 * safe. Bounded per pass by the list limit; the next scheduled run picks up any remainder.
 */
export async function sweepExpiredReservations(ctx: StoreContext): Promise<SweepResult> {
  const expired = await listExpiredReservations(ctx, asSystem('reservation sweeper'));

  let released = 0;
  let skipped = 0;
  for (const reservation of expired) {
    const outcome = await releaseReservation(ctx, reservation.id);
    if (outcome.released) released += 1;
    else skipped += 1;
  }

  return { found: expired.length, released, skipped };
}
