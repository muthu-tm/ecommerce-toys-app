import { randomUUID } from 'node:crypto';

import type {
  EventDoc,
  InventoryDoc,
  InventoryLedgerDoc,
  OrderDoc,
  OrderEventDoc,
  ReservationDoc,
} from '@romp/contracts';
import {
  RESERVATION_HOLDING_STATUSES,
  fulfilmentStatusMachine,
  orderStatusMachine,
} from '@romp/contracts';
import { applyStockDelta } from '@romp/core';
import { NotFoundError, assertTransition } from '@romp/observability';

import type { Caller, StoreContext } from '../context';
import { actorIdOf, requireStaff } from '../context';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

import { appendEventInTransaction } from './events';

/**
 * Cancelling an order — the one write that has to undo whatever the order did to stock, and the undo
 * depends on how far the order got.
 *
 * There are two shapes of cancellation, and conflating them corrupts inventory:
 *
 *  - **Before payment settled** (`awaiting_payment`, `pending_verification`, `payment_rejected`) the
 *    order only ever *reserved* stock — on-hand never moved (Task 16). So cancelling is the same
 *    undo the sweeper does: lower `inventory.reserved` by the held quantity, release the reservation,
 *    and write **no** inventory-ledger entry, because the ledger records on-hand movement and there
 *    was none. The units return to *available* without on-hand changing.
 *
 *  - **After payment settled** (`paid`) verification already committed the stock: on-hand fell and
 *    the reservation resolved to `committed` (Task 18). Cancelling a paid order therefore restocks —
 *    if the goods are sellable — by raising on-hand and writing an `order_cancelled` ledger entry per
 *    (variant, warehouse), the mirror of the commit's `order_committed`. A refund of the money is a
 *    separate owner-only action (`issueRefund`); this write does not move money.
 *
 * Either way the order moves to `cancelled` on **both** machines — payment status and fulfilment
 * status — because a cancelled order is neither awaiting anything nor going to ship. A reason is
 * required; it is recorded on the audit trail and, unlike a hold reason, is a customer-facing fact.
 */

/** The operator's cancellation decision. */
export interface CancelOrderInput {
  readonly orderId: string;
  readonly reason: string;
  /**
   * Whether committed units return to sellable on-hand. Only consulted for a paid order — a
   * pre-payment cancel releases the reservation regardless, since those units never left on-hand.
   */
  readonly restock: boolean;
}

export interface CancelOrderResult {
  readonly orderId: string;
  readonly status: OrderDoc['status'];
}

/**
 * Cancels an order, undoing its effect on stock according to how far it progressed.
 *
 * Staff-gated. In one transaction it reads the order, refuses an illegal cancellation
 * (`assertTransition` on the order machine — `expired`, `refunded` and an already-`cancelled` order
 * cannot be cancelled), then branches: a pre-payment order releases its reservation and lowers
 * `reserved`; a paid order optionally restocks on-hand with an `order_cancelled` ledger entry. It
 * moves both the order status and the fulfilment status to `cancelled`, and appends the audit
 * events with the reason.
 */
export async function cancelOrder(
  ctx: StoreContext,
  caller: Caller,
  input: CancelOrderInput,
): Promise<CancelOrderResult> {
  requireStaff(caller, { resource: 'orders' });
  const now = ctx.clock.now();
  const actorId = actorIdOf(caller);

  const orderRef = ctx.db.doc(paths.order(input.orderId)).withConverter(converters.orders);

  return ctx.db.runTransaction(async (tx) => {
    const current = (await tx.get(orderRef)).data();
    if (current === undefined) {
      throw new NotFoundError({ context: { resource: 'order', id: input.orderId } });
    }

    // The order machine decides what may be cancelled: expired, refunded and cancelled are terminal.
    assertTransition(orderStatusMachine, current.status, 'cancelled', { orderId: input.orderId });
    // Fulfilment must also be able to reach cancelled — a shipped or delivered order cannot be, and
    // that is caught here rather than leaving the two machines disagreeing.
    assertTransition(fulfilmentStatusMachine, current.fulfilment.status, 'cancelled', {
      orderId: input.orderId,
    });

    const wasHolding = RESERVATION_HOLDING_STATUSES.includes(current.status);

    // --- release-or-restock ------------------------------------------------
    if (wasHolding) {
      await releaseHeldStock(ctx, tx, current, now);
    } else if (current.status === 'paid' && input.restock) {
      await restockCommittedStock(ctx, tx, current, input.orderId, actorId, now);
    }

    // --- the order itself: cancelled on both machines ----------------------
    const nextOrder: OrderDoc = {
      ...current,
      status: 'cancelled',
      fulfilment: { ...current.fulfilment, status: 'cancelled' },
      updatedAt: now,
    };
    tx.set(orderRef, nextOrder);

    const orderEvent: OrderEventDoc = {
      orderId: input.orderId as OrderEventDoc['orderId'],
      type: 'order.cancelled',
      actorId: actorId as OrderEventDoc['actorId'],
      actorRole: 'staff',
      payload: { reason: input.reason, cancelledBy: actorId },
      at: now,
    };
    tx.set(
      ctx.db
        .doc(paths.orderEvent(input.orderId, randomUUID()))
        .withConverter(converters.orderEvents),
      orderEvent,
    );

    const spineEvent: EventDoc = {
      type: 'order.cancelled',
      actorId: actorId as EventDoc['actorId'],
      subject: { kind: 'order', id: input.orderId },
      payload: {
        type: 'order.cancelled',
        orderId: input.orderId as never,
        humanId: current.humanId,
        userId: current.userId,
        reason: input.reason,
      },
      at: now,
    };
    appendEventInTransaction(tx, ctx, spineEvent);

    return { orderId: input.orderId, status: nextOrder.status };
  });
}

/** A minimal transaction surface — the same shape `runTransaction` hands the callback. */
interface Tx {
  get: (ref: ReturnType<StoreContext['db']['doc']>) => Promise<{ data: () => unknown }>;
  set: (ref: ReturnType<StoreContext['db']['doc']>, data: unknown) => void;
}

/**
 * Pre-payment cancel: release the reservation and lower `reserved`, exactly as the sweeper does.
 *
 * No inventory-ledger entry: on-hand never moved for a held reservation, and the ledger records
 * on-hand movement. Lowering `reserved` can never break the oversell invariant, so the write always
 * validates. If the reservation is gone or no longer active, there is nothing to release — the units
 * were freed by whatever resolved it — so the order is still cancelled without touching inventory.
 */
async function releaseHeldStock(
  ctx: StoreContext,
  tx: Tx,
  order: OrderDoc,
  now: Date,
): Promise<void> {
  if (order.reservationId === null) return;

  const reservationRef = ctx.db
    .doc(paths.reservation(order.reservationId))
    .withConverter(converters.reservations);
  const reservation = (await tx.get(reservationRef)).data() as ReservationDoc | undefined;
  if (reservation?.status !== 'active') return;

  // Read every affected inventory record before writing.
  const inventoryReads = await Promise.all(
    reservation.items.map(async (item) => {
      const ref = ctx.db.doc(paths.inventory(item.variantId)).withConverter(converters.inventory);
      return { item, ref, inventory: (await tx.get(ref)).data() as InventoryDoc | undefined };
    }),
  );

  for (const { item, ref, inventory } of inventoryReads) {
    if (inventory === undefined) continue;
    const nextReserved = Math.max(0, inventory.reserved - item.qty);
    const next: InventoryDoc = { ...inventory, reserved: nextReserved, updatedAt: now };
    tx.set(ref, next);
  }

  const nextReservation: ReservationDoc = { ...reservation, status: 'released', resolvedAt: now };
  tx.set(reservationRef, nextReservation);
}

/**
 * Paid cancel with restock: raise on-hand at the warehouses that were committed, and record each
 * movement as an `order_cancelled` ledger entry — the mirror of the commit's `order_committed`.
 *
 * A positive delta can never trip the oversell guard, so this always applies. The order's own
 * `allocation` (`{ variant: { warehouse: qty } }`) is what shipped, so it is what returns. Every
 * inventory record is read before any write, to keep to the transaction's read-before-write rule.
 */
async function restockCommittedStock(
  ctx: StoreContext,
  tx: Tx,
  order: OrderDoc,
  orderId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  const inventoryReads = await Promise.all(
    Object.entries(order.allocation).map(async ([variantId, byWarehouse]) => {
      const ref = ctx.db.doc(paths.inventory(variantId)).withConverter(converters.inventory);
      return {
        variantId,
        byWarehouse,
        ref,
        inventory: (await tx.get(ref)).data() as InventoryDoc | undefined,
      };
    }),
  );

  for (const { variantId, byWarehouse, ref, inventory } of inventoryReads) {
    if (inventory === undefined) continue; // Nothing to restock into; skip the line.
    let stock = inventory.stock;
    for (const [warehouseId, qty] of Object.entries(byWarehouse)) {
      const applied = applyStockDelta(stock, warehouseId, qty, inventory.reserved);
      if (applied.ok) stock = applied.next.stock;
    }
    const onHandTotal = Object.values(stock).reduce((total, units) => total + units, 0);
    const next: InventoryDoc = { ...inventory, stock, onHandTotal, updatedAt: now };
    tx.set(ref, next);

    for (const [warehouseId, qty] of Object.entries(byWarehouse)) {
      const entry: InventoryLedgerDoc = {
        variantId: variantId as InventoryLedgerDoc['variantId'],
        productId: inventory.productId,
        warehouseId: warehouseId as InventoryLedgerDoc['warehouseId'],
        delta: qty,
        reason: 'order_cancelled',
        actorId: actorId as InventoryLedgerDoc['actorId'],
        refId: orderId,
        note: null,
        at: now,
      };
      tx.set(
        ctx.db
          .collection(COLLECTIONS.inventoryLedger)
          .doc()
          .withConverter(converters.inventoryLedger),
        entry,
      );
    }
  }
}
