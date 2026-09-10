import type { InventoryDoc, InventoryLedgerDoc, InventoryLedgerReason } from '@romp/contracts';
import { applyStockDelta } from '@romp/core';
import type { StockByWarehouse } from '@romp/core';

import type { Caller, StoreContext } from '../context';
import { actorIdOf, requireStaff } from '../context';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

/**
 * The inventory write path — a per-warehouse stock adjustment.
 *
 * Two documents move together and must never drift: the materialised balance
 * (`inventory/{variantId}`) that every availability check reads, and the append-only
 * `inventoryLedger` entry that explains the movement. So an adjustment is one transaction that
 * reads the balance, applies the delta with `@romp/core`'s pure arithmetic (which refuses a
 * negative warehouse count or an oversell), and writes the new balance and the ledger entry
 * atomically. A crash between them is impossible; a balance that disagrees with its ledger is
 * a reconciliation the runbook exists for, not a routine outcome.
 *
 * Adjustments are entries, never edits: correcting a mistake is a compensating delta with its
 * own ledger row, so the history of what was believed and when survives.
 */

/** Raised when an adjustment would break a stock invariant. */
export class StockAdjustmentError extends Error {
  readonly reason: 'negative_warehouse_stock' | 'oversell';
  constructor(reason: 'negative_warehouse_stock' | 'oversell') {
    super(
      reason === 'oversell'
        ? 'The adjustment would drop on-hand stock below what reservations are holding.'
        : 'The adjustment would take a warehouse below zero stock.',
    );
    this.name = 'StockAdjustmentError';
    this.reason = reason;
  }
}

export interface InventoryAdjustment {
  readonly variantId: string;
  readonly productId: string;
  readonly warehouseId: string;
  /** Signed: positive adds stock, negative removes it. */
  readonly delta: number;
  readonly reason: InventoryLedgerReason;
  /** Free-text explanation; required for a manual adjustment, where the reason enum is thin. */
  readonly note: string | null;
  /** Order/refund ID for a system movement, or null for a manual adjustment. */
  readonly refId: string | null;
  /** Low-stock threshold to seed a brand-new inventory record with. */
  readonly lowStockThreshold: number;
}

export interface InventoryAdjustmentResult {
  readonly onHandTotal: number;
  readonly reserved: number;
  readonly stock: StockByWarehouse;
  readonly ledgerEntryId: string;
}

/**
 * Applies a signed stock delta to one warehouse and records the movement.
 *
 * Reads the inventory document (treating an absent one as an empty balance, so a first
 * adjustment creates it), applies the delta through `@romp/core`, and — on success — writes
 * the new balance and appends a ledger entry in the same transaction. On a refusal it throws a
 * `StockAdjustmentError` the API maps to a 409, having written nothing.
 *
 * `reserved` is read from the current record and left unchanged: an adjustment moves on-hand,
 * not reservations, but the oversell rule uses `reserved` to bound how far on-hand may fall.
 */
export async function adjustInventory(
  ctx: StoreContext,
  caller: Caller,
  adjustment: InventoryAdjustment,
): Promise<InventoryAdjustmentResult> {
  requireStaff(caller, { resource: 'inventory' });

  const inventoryRef = ctx.db
    .doc(paths.inventory(adjustment.variantId))
    .withConverter(converters.inventory);
  const ledgerRef = ctx.db.collection(COLLECTIONS.inventoryLedger).doc();
  const now = ctx.clock.now();

  const result = await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(inventoryRef);
    const current = snapshot.data();

    const stock: StockByWarehouse = current?.stock ?? {};
    const reserved = current?.reserved ?? 0;

    const applied = applyStockDelta(stock, adjustment.warehouseId, adjustment.delta, reserved);
    if (!applied.ok) {
      throw new StockAdjustmentError(applied.reason);
    }

    const nextInventory: InventoryDoc = {
      productId: adjustment.productId as InventoryDoc['productId'],
      stock: applied.next.stock,
      onHandTotal: applied.next.onHandTotal,
      reserved,
      lowStockThreshold: current?.lowStockThreshold ?? adjustment.lowStockThreshold,
      updatedAt: now,
    };

    const ledgerEntry: InventoryLedgerDoc = {
      variantId: adjustment.variantId as InventoryLedgerDoc['variantId'],
      productId: adjustment.productId as InventoryLedgerDoc['productId'],
      warehouseId: adjustment.warehouseId as InventoryLedgerDoc['warehouseId'],
      delta: adjustment.delta,
      reason: adjustment.reason,
      actorId: actorIdOf(caller) as InventoryLedgerDoc['actorId'],
      refId: adjustment.refId,
      note: adjustment.note,
      at: now,
    };

    tx.set(inventoryRef, nextInventory);
    tx.set(ledgerRef.withConverter(converters.inventoryLedger), ledgerEntry);

    return {
      onHandTotal: nextInventory.onHandTotal,
      reserved: nextInventory.reserved,
      stock: nextInventory.stock,
    };
  });

  return { ...result, ledgerEntryId: ledgerRef.id };
}
