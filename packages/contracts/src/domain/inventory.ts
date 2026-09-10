import { z } from 'zod';

/**
 * Inventory movement reasons for the append-only ledger.
 *
 * Every change to stock writes an entry. The ledger is the source of truth for
 * movement; `inventory.stock` is a materialised balance. When they disagree, the
 * ledger wins and the balance is wrong — which is what makes the reconciliation
 * runbook possible at all.
 *
 * Adjustments are **entries, never edits**. Correcting a mistake appends a
 * compensating entry, so the history of what was believed and when survives.
 */
export const InventoryLedgerReasonSchema = z.enum([
  /** Manual correction by an admin, including physical stock counts. */
  'adjustment',
  /** Payment verified: reserved units decremented from on-hand. */
  'order_committed',
  /** Order cancelled or expired: reserved units released back to available. */
  'order_cancelled',
  /** Refund with restock: units returned to on-hand. */
  'refund_restock',
  /** Initial load from the seed script. */
  'seed',
  /** Reconciliation after a discrepancy — see RUNBOOKS.md runbook 4. */
  'reconciliation',
]);
export type InventoryLedgerReason = z.infer<typeof InventoryLedgerReasonSchema>;

/** Reasons an admin may select directly. The rest are written by the system. */
export const OPERATOR_SELECTABLE_REASONS: readonly InventoryLedgerReason[] = Object.freeze([
  'adjustment',
  'reconciliation',
]);

/** A non-negative count of physical units. */
export const QuantitySchema = z
  .int({ error: 'A quantity is a whole number of units.' })
  .nonnegative({ error: 'A quantity cannot be negative.' })
  .brand<'Quantity'>();
export type Quantity = z.infer<typeof QuantitySchema>;

/** A signed stock movement. Ledger deltas go both ways; balances never do. */
export const QuantityDeltaSchema = z
  .int({ error: 'A stock movement is a whole number of units.' })
  .brand<'QuantityDelta'>();
export type QuantityDelta = z.infer<typeof QuantityDeltaSchema>;

export function quantity(units: number): Quantity {
  return QuantitySchema.parse(units);
}

export function quantityDelta(units: number): QuantityDelta {
  return QuantityDeltaSchema.parse(units);
}

/**
 * Available stock: on-hand minus what unexpired reservations are holding.
 *
 * Returns a plain number rather than a `Quantity` when negative, because a negative
 * result is exactly the condition a caller needs to detect and refuse — coercing it
 * through a non-negative schema would throw before the caller could produce a
 * useful `INSUFFICIENT_STOCK` message.
 */
export function availableStock(onHandTotal: number, reserved: number): number {
  return onHandTotal - reserved;
}
