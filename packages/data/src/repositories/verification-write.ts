import { randomUUID } from 'node:crypto';

import type {
  EventDoc,
  InventoryDoc,
  InventoryLedgerDoc,
  OrderDoc,
  OrderEventDoc,
  ReservationDoc,
} from '@romp/contracts';
import { orderStatusMachine } from '@romp/contracts';
import { applyStockDelta } from '@romp/core';
import {
  InvalidStateTransitionError,
  NotFoundError,
  PaymentAmountMismatchError,
  assertTransition,
} from '@romp/observability';

import type { Caller, StoreContext } from '../context';
import { actorIdOf, requireStaff } from '../context';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

import { appendEventInTransaction } from './events';

/**
 * Payment verification — the admin decision that turns a claimed payment into a paid order.
 *
 * There is no gateway; a customer paid by manual UPI transfer and quoted a reference, and an admin
 * reads the bank statement and decides. This is the write that records that decision, and it is the
 * one that finally *moves* stock. Placement (Task 16) only raised `inventory.reserved` — the units
 * are not gone until the money is confirmed — so verifying is where on-hand is decremented, the
 * reservation is resolved to `committed`, and the movement is written to the inventory ledger. All
 * of that commits in one transaction with the status change, or none of it does.
 *
 * The amount check is **exact**, deliberately. The admin enters the amount that actually settled,
 * and it must equal `order.amounts.totalMinor` to the paise — a short payment is never accepted as
 * "close enough" (`SECURITY.md § payments`). A mismatch is a `PaymentAmountMismatchError` carrying
 * both figures, so the admin acts on the real difference (a top-up, a rejection, or a refund of an
 * overpayment) rather than the system quietly rounding.
 */

/** The admin's verification decision: the order, and the amount that actually settled. */
export interface VerifyPaymentInput {
  readonly orderId: string;
  /** The amount the admin read from the bank, in paise. Must equal the order total exactly. */
  readonly paidAmountMinor: number;
}

export interface VerifyPaymentResult {
  readonly orderId: string;
  readonly status: OrderDoc['status'];
}

export interface RejectPaymentInput {
  readonly orderId: string;
  readonly reason: string;
}

export interface RejectPaymentResult {
  readonly orderId: string;
  readonly status: OrderDoc['status'];
}

/**
 * Verifies a payment: commits the reserved stock and marks the order paid.
 *
 * Staff-gated (verifying is a staff action; sending money back is owner-only, in `issueRefund`).
 * In one transaction it asserts the order is awaiting verification, checks the amount exactly, then
 * for every reserved unit lowers both `reserved` and on-hand at its allocated warehouse, writes an
 * `order_committed` ledger entry per (variant, warehouse), resolves the reservation to `committed`,
 * marks the order `paid` with the acting admin recorded, and appends the audit events. A second call
 * finds the order already `paid` and is refused by the status machine, so the action is idempotent
 * against a double-click without an idempotency key.
 */
export async function verifyPayment(
  ctx: StoreContext,
  caller: Caller,
  input: VerifyPaymentInput,
): Promise<VerifyPaymentResult> {
  requireStaff(caller, { resource: 'orders' });
  const now = ctx.clock.now();
  const actorId = actorIdOf(caller);

  const orderRef = ctx.db.doc(paths.order(input.orderId)).withConverter(converters.orders);

  return ctx.db.runTransaction(async (tx) => {
    const current = (await tx.get(orderRef)).data();
    if (current === undefined) {
      throw new NotFoundError({ context: { resource: 'order', id: input.orderId } });
    }

    // Legal only from `pending_verification`. A double-verify (already `paid`) is refused here.
    assertTransition(orderStatusMachine, current.status, 'paid', { orderId: input.orderId });

    // Exact-amount match, to the paise. Never "close enough".
    if (input.paidAmountMinor !== current.amounts.totalMinor) {
      throw new PaymentAmountMismatchError({
        expectedMinor: current.amounts.totalMinor,
        paidMinor: input.paidAmountMinor,
      });
    }

    if (current.reservationId === null) {
      // A pending-verification order with no reservation to commit is a broken invariant.
      throw new InvalidStateTransitionError({
        detail: 'This order has no live reservation to commit.',
        context: { orderId: input.orderId, reason: 'missing_reservation' },
      });
    }
    const reservationRef = ctx.db
      .doc(paths.reservation(current.reservationId))
      .withConverter(converters.reservations);
    const heldReservation = (await tx.get(reservationRef)).data();
    if (heldReservation?.status !== 'active') {
      // The hold is gone (expired/released) — cannot commit what is no longer held.
      throw new InvalidStateTransitionError({
        detail: 'This order’s stock hold is no longer active.',
        context: { orderId: input.orderId, reason: 'reservation_not_active' },
      });
    }

    // Read every affected inventory record before any write.
    const inventoryReads = await Promise.all(
      heldReservation.items.map(async (item) => {
        const ref = ctx.db.doc(paths.inventory(item.variantId)).withConverter(converters.inventory);
        return { item, ref, inventory: (await tx.get(ref)).data() };
      }),
    );

    // Commit each line: decrement on-hand at every allocated warehouse and lower `reserved` by the
    // held quantity together, so the units leave the hold and the shelf in one move.
    const inventoryWrites: { ref: (typeof inventoryReads)[number]['ref']; next: InventoryDoc }[] =
      [];
    const ledgerEntries: InventoryLedgerDoc[] = [];

    for (const { item, ref, inventory } of inventoryReads) {
      if (inventory === undefined) {
        // No inventory record for a reserved variant is a broken invariant.
        throw new InvalidStateTransitionError({
          detail: 'A reserved variant has no inventory record to commit against.',
          context: { orderId: input.orderId, variantId: item.variantId },
        });
      }
      const record = inventory;

      // The oversell guard bounds on-hand against `reserved`; during commit both fall for the same
      // units, so bound against the *post-commit* reserved or it spuriously reports oversell.
      const nextReserved = record.reserved - item.qty;
      let stock = record.stock;

      for (const [warehouseId, qty] of Object.entries(item.allocation)) {
        const applied = applyStockDelta(stock, warehouseId, -qty, nextReserved);
        if (!applied.ok) {
          // A committed reservation should always be coverable by on-hand; if not, the invariant
          // broke upstream. Refuse rather than write an impossible balance.
          throw new InvalidStateTransitionError({
            detail: 'Committing this order would take stock below zero.',
            context: { orderId: input.orderId, variantId: item.variantId, reason: applied.reason },
          });
        }
        stock = applied.next.stock;

        ledgerEntries.push({
          variantId: item.variantId,
          productId: record.productId,
          warehouseId: warehouseId as InventoryLedgerDoc['warehouseId'],
          delta: -qty,
          reason: 'order_committed',
          actorId: actorId as InventoryLedgerDoc['actorId'],
          refId: input.orderId,
          note: null,
          at: now,
        });
      }

      const onHandTotal = Object.values(stock).reduce((total, units) => total + units, 0);
      inventoryWrites.push({
        ref,
        next: { ...record, stock, onHandTotal, reserved: nextReserved, updatedAt: now },
      });
    }

    const nextOrder: OrderDoc = {
      ...current,
      status: 'paid',
      payment: {
        ...current.payment,
        verifiedBy: actorId as NonNullable<OrderDoc['payment']['verifiedBy']>,
        verifiedAt: now,
        // A verify after an earlier rejection clears the stale rejection so the record reads clean.
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      },
      updatedAt: now,
    };

    const nextReservation: ReservationDoc = {
      ...heldReservation,
      status: 'committed',
      resolvedAt: now,
    };

    // --- writes ---
    for (const write of inventoryWrites) {
      tx.set(write.ref, write.next);
    }
    for (const entry of ledgerEntries) {
      tx.set(
        ctx.db
          .collection(COLLECTIONS.inventoryLedger)
          .doc()
          .withConverter(converters.inventoryLedger),
        entry,
      );
    }
    tx.set(orderRef, nextOrder);
    tx.set(reservationRef, nextReservation);

    const orderEvent: OrderEventDoc = {
      orderId: input.orderId as OrderEventDoc['orderId'],
      type: 'order.payment_verified',
      actorId: actorId as OrderEventDoc['actorId'],
      actorRole: 'staff',
      payload: { verifiedBy: actorId },
      at: now,
    };
    tx.set(
      ctx.db
        .doc(paths.orderEvent(input.orderId, randomUUID()))
        .withConverter(converters.orderEvents),
      orderEvent,
    );

    const spineEvent: EventDoc = {
      type: 'order.payment_verified',
      actorId: actorId as EventDoc['actorId'],
      subject: { kind: 'order', id: input.orderId },
      payload: {
        type: 'order.payment_verified',
        orderId: input.orderId as never,
        humanId: current.humanId,
        userId: current.userId,
        verifiedBy: actorId as never,
      },
      at: now,
    };
    appendEventInTransaction(tx, ctx, spineEvent);

    return { orderId: input.orderId, status: nextOrder.status };
  });
}

/**
 * Rejects a payment: the admin could not match it. The order returns to the customer to resubmit.
 *
 * Staff-gated. It records the reason (shown to the customer) and the acting admin, and moves the
 * order to `payment_rejected` — from which the customer may submit a fresh reference, which is why
 * the stock stays reserved rather than being released. Releasing here would force the customer to
 * re-place and re-reserve an order they may simply have mistyped the UTR for.
 */
export async function rejectPayment(
  ctx: StoreContext,
  caller: Caller,
  input: RejectPaymentInput,
): Promise<RejectPaymentResult> {
  requireStaff(caller, { resource: 'orders' });
  const now = ctx.clock.now();
  const actorId = actorIdOf(caller);

  const orderRef = ctx.db.doc(paths.order(input.orderId)).withConverter(converters.orders);

  return ctx.db.runTransaction(async (tx) => {
    const current = (await tx.get(orderRef)).data();
    if (current === undefined) {
      throw new NotFoundError({ context: { resource: 'order', id: input.orderId } });
    }

    assertTransition(orderStatusMachine, current.status, 'payment_rejected', {
      orderId: input.orderId,
    });

    const nextOrder: OrderDoc = {
      ...current,
      status: 'payment_rejected',
      payment: {
        ...current.payment,
        rejectedBy: actorId as NonNullable<OrderDoc['payment']['rejectedBy']>,
        rejectedAt: now,
        rejectionReason: input.reason,
      },
      updatedAt: now,
    };
    tx.set(orderRef, nextOrder);

    const orderEvent: OrderEventDoc = {
      orderId: input.orderId as OrderEventDoc['orderId'],
      type: 'order.payment_rejected',
      actorId: actorId as OrderEventDoc['actorId'],
      actorRole: 'staff',
      payload: { rejectedBy: actorId, reason: input.reason },
      at: now,
    };
    tx.set(
      ctx.db
        .doc(paths.orderEvent(input.orderId, randomUUID()))
        .withConverter(converters.orderEvents),
      orderEvent,
    );

    const spineEvent: EventDoc = {
      type: 'order.payment_rejected',
      actorId: actorId as EventDoc['actorId'],
      subject: { kind: 'order', id: input.orderId },
      payload: {
        type: 'order.payment_rejected',
        orderId: input.orderId as never,
        humanId: current.humanId,
        userId: current.userId,
        rejectedBy: actorId as never,
        reason: input.reason,
      },
      at: now,
    };
    appendEventInTransaction(tx, ctx, spineEvent);

    return { orderId: input.orderId, status: nextOrder.status };
  });
}
