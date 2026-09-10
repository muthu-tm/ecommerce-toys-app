import { z } from 'zod';

/**
 * Refunds.
 *
 * There is no state machine here, and that is the design: refunds are
 * **append-only**. A refund record is created, and it is never edited. A wrong
 * amount is corrected by a second, adjusting record; a duplicate transfer is
 * recorded as a duplicate.
 *
 * The reason is reconciliation. Refunds are manual UPI transfers, so the system's
 * record is an assertion by an admin and the bank statement is the fact. If an
 * amount could be edited, a discrepancy between the two could no longer be
 * distinguished from a correction, and the next person to look could not tell
 * whether they were seeing a bug or a fix.
 */

export const RefundModeSchema = z.enum(['full', 'partial']);
export type RefundMode = z.infer<typeof RefundModeSchema>;

export const RefundReasonSchema = z.enum([
  /** Customer changed their mind before dispatch. */
  'customer_cancelled',
  /** Stock was not actually available — the oversell path. */
  'out_of_stock',
  /** Item arrived damaged. */
  'damaged',
  /** Wrong item shipped. */
  'wrong_item',
  /** Delivery failed and the parcel came back. */
  'delivery_failed',
  /** Customer overpaid, or paid twice for one order. */
  'overpayment',
  /** Correcting an earlier refund that was for the wrong amount. */
  'adjustment',
  /** Recording a refund that was accidentally sent twice. */
  'duplicate_refund',
  /** Anything else; requires a free-text note. */
  'other',
]);
export type RefundReason = z.infer<typeof RefundReasonSchema>;

/**
 * Reasons that imply the goods are coming back and stock should be restored.
 *
 * A suggestion for the admin UI's default, not an enforcement: `damaged` goods
 * physically return but are not resellable, so the operator makes the final call
 * and the ledger records what they chose.
 */
export const RESTOCK_SUGGESTED_REASONS: readonly RefundReason[] = Object.freeze([
  'customer_cancelled',
  'out_of_stock',
  'wrong_item',
  'delivery_failed',
]);

/** Reasons that must carry an explanatory note, because the enum alone says too little. */
export const NOTE_REQUIRED_REASONS: readonly RefundReason[] = Object.freeze([
  'other',
  'adjustment',
  'duplicate_refund',
]);
