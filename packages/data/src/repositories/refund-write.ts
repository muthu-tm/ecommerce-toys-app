import { randomUUID } from 'node:crypto';

import type {
  EventDoc,
  InventoryDoc,
  InventoryLedgerDoc,
  OrderDoc,
  OrderEventDoc,
  RefundDoc,
  RefundMode,
  RefundReason,
} from '@romp/contracts';
import { orderStatusMachine } from '@romp/contracts';
import { applyStockDelta } from '@romp/core';
import {
  InvalidStateTransitionError,
  NotFoundError,
  RefundExceedsRefundableError,
  assertTransition,
} from '@romp/observability';

import type { Caller, StoreContext } from '../context';
import { actorIdOf, requireOwnerRole } from '../context';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

import { appendEventInTransaction } from './events';

/**
 * Refunds — the one action that moves money outward, and the only one gated on the `owner` claim.
 *
 * A refund is a manual UPI transfer the operator makes, so the system's job is not to move money but
 * to **record the decision** and keep the books straight: the order's running `refundedMinor` rises,
 * capped at the total; the refund is an append-only record (a wrong amount is corrected by a second,
 * adjusting refund, never an edit, so a discrepancy with the bank statement is always a fix rather
 * than a rewrite); and, if the goods came back sellable, the units return to on-hand through a
 * `refund_restock` ledger entry — the mirror of the commit's `order_committed`. Everything commits
 * in one transaction, or nothing does.
 *
 * Owner-only, not staff: `SECURITY.md` singles out the money-outward action for the higher claim,
 * because a compromised or careless staff account marking orders paid is bounded by per-order value,
 * but one issuing refunds is not.
 */

/** The operator's refund decision. `amountMinor` is authoritative; `mode` is the label they chose. */
export interface IssueRefundInput {
  readonly orderId: string;
  readonly mode: RefundMode;
  readonly amountMinor: number;
  readonly reason: RefundReason;
  readonly note: string | null;
  /** The reference of the money actually sent back, or null while the record precedes the transfer. */
  readonly outwardUpiRef: string | null;
  /** Whether the units return to sellable on-hand stock. */
  readonly restock: boolean;
}

export interface IssueRefundResult {
  readonly refundId: string;
  readonly orderId: string;
  readonly status: OrderDoc['status'];
  readonly refundedMinor: number;
}

/**
 * Issues a refund against a paid order.
 *
 * Owner-gated. In one transaction it reads the order, refuses if the amount would carry
 * `refundedMinor` past the total (`RefundExceedsRefundableError`), writes the append-only refund
 * record, raises the order's `refundedMinor`, moves the order to `refunded` once the whole total has
 * been returned, optionally restocks the allocated warehouses, and appends the audit events. The
 * refund's `userId` is denormalised from the order so the customer's own refund read needs no join.
 */
export async function issueRefund(
  ctx: StoreContext,
  caller: Caller,
  input: IssueRefundInput,
): Promise<IssueRefundResult> {
  requireOwnerRole(caller, { resource: 'refunds' });
  const now = ctx.clock.now();
  const actorId = actorIdOf(caller);

  const orderRef = ctx.db.doc(paths.order(input.orderId)).withConverter(converters.orders);
  const refundRef = ctx.db.collection(COLLECTIONS.refunds).doc();
  const refundId = refundRef.id;

  return ctx.db.runTransaction(async (tx) => {
    const order = (await tx.get(orderRef)).data();
    if (order === undefined) {
      throw new NotFoundError({ context: { resource: 'order', id: input.orderId } });
    }

    // Only a paid order can be refunded; the machine's only refund edge is `paid → refunded`.
    if (order.status !== 'paid' && order.status !== 'refunded') {
      throw new InvalidStateTransitionError({
        detail: 'Only a paid order can be refunded.',
        context: { orderId: input.orderId, from: order.status, to: 'refunded' },
      });
    }

    // The cap check that a schema cannot do, inside the transaction that writes the refund.
    const remaining = order.amounts.totalMinor - order.amounts.refundedMinor;
    if (input.amountMinor > remaining) {
      throw new RefundExceedsRefundableError({
        requestedMinor: input.amountMinor,
        refundableMinor: remaining,
      });
    }

    const nextRefunded = order.amounts.refundedMinor + input.amountMinor;
    const fullyRefunded = nextRefunded === order.amounts.totalMinor;

    // Read inventory up front if restocking, before any write.
    const inventoryReads = input.restock
      ? await Promise.all(
          Object.entries(order.allocation).map(async ([variantId, byWarehouse]) => {
            const ref = ctx.db.doc(paths.inventory(variantId)).withConverter(converters.inventory);
            return { variantId, byWarehouse, ref, inventory: (await tx.get(ref)).data() };
          }),
        )
      : [];

    const refund: RefundDoc = {
      orderId: input.orderId as RefundDoc['orderId'],
      userId: order.userId,
      mode: input.mode,
      amountMinor: input.amountMinor as RefundDoc['amountMinor'],
      reason: input.reason,
      note: input.note,
      outwardUpiRef: (input.outwardUpiRef as RefundDoc['outwardUpiRef']) ?? null,
      restock: input.restock,
      createdBy: actorId as RefundDoc['createdBy'],
      createdAt: now,
    };
    tx.set(refundRef.withConverter(converters.refunds), refund);

    // Restock: return units to on-hand at the warehouses that shipped them. A positive delta can
    // never trip the oversell guard, so this always applies.
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
          reason: 'refund_restock',
          actorId: actorId as InventoryLedgerDoc['actorId'],
          refId: refundId,
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

    const nextOrder: OrderDoc = {
      ...order,
      status: fullyRefunded ? 'refunded' : order.status,
      amounts: {
        ...order.amounts,
        refundedMinor: nextRefunded as OrderDoc['amounts']['refundedMinor'],
      },
      updatedAt: now,
    };
    if (fullyRefunded && order.status !== 'refunded') {
      assertTransition(orderStatusMachine, order.status, 'refunded', { orderId: input.orderId });
    }
    tx.set(orderRef, nextOrder);

    const orderEvent: OrderEventDoc = {
      orderId: input.orderId as OrderEventDoc['orderId'],
      type: 'refund.issued',
      actorId: actorId as OrderEventDoc['actorId'],
      actorRole: 'owner',
      payload: { refundId, amountMinor: input.amountMinor },
      at: now,
    };
    tx.set(
      ctx.db
        .doc(paths.orderEvent(input.orderId, randomUUID()))
        .withConverter(converters.orderEvents),
      orderEvent,
    );

    const spineEvent: EventDoc = {
      type: 'refund.issued',
      actorId: actorId as EventDoc['actorId'],
      subject: { kind: 'refund', id: refundId },
      payload: {
        type: 'refund.issued',
        orderId: input.orderId as never,
        humanId: order.humanId,
        userId: order.userId,
        refundId: refundId as never,
        amountMinor: input.amountMinor as never,
      },
      at: now,
    };
    appendEventInTransaction(tx, ctx, spineEvent);

    return {
      refundId,
      orderId: input.orderId,
      status: nextOrder.status,
      refundedMinor: nextRefunded,
    };
  });
}
