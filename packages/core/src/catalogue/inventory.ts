/**
 * The pure logic behind an inventory adjustment.
 *
 * An adjustment moves stock at one warehouse by a signed delta, and the materialised balance
 * a product's availability reads — `inventory.stock` per warehouse and `onHandTotal` — must
 * stay consistent with the append-only ledger that explains every movement. This module owns
 * the arithmetic and the two rules a balance can never violate: per-warehouse stock is never
 * negative, and on-hand can never drop below what unexpired reservations hold (the oversell
 * invariant). Keeping it here, pure, means those rules are unit-tested without an emulator —
 * where an off-by-one is a customer buying stock that does not exist.
 *
 * The Firestore transaction in `@romp/data` calls this, then writes the new balance and the
 * ledger entry atomically. Nothing here touches Firestore; it takes the current numbers and
 * returns the next ones, or a typed refusal.
 */

/** The per-warehouse on-hand map: warehouse code -> non-negative unit count. */
export type StockByWarehouse = Readonly<Record<string, number>>;

export interface StockDeltaResult {
  readonly stock: StockByWarehouse;
  readonly onHandTotal: number;
}

export type ApplyStockDeltaResult =
  | { readonly ok: true; readonly next: StockDeltaResult }
  | { readonly ok: false; readonly reason: StockDeltaRefusal };

/**
 * Why an adjustment was refused.
 *
 *  - `negative_warehouse_stock`: the delta would take one warehouse below zero, which is a
 *    physically impossible count and almost always a sign flip in the request.
 *  - `oversell`: the delta would take on-hand below the units unexpired reservations hold, so
 *    a reserved order could no longer be fulfilled. Refused rather than clamped, because
 *    clamping hides the fact that a promise was broken.
 */
export type StockDeltaRefusal = 'negative_warehouse_stock' | 'oversell';

/**
 * Applies a signed stock delta to one warehouse, returning the new balance or a refusal.
 *
 * `reserved` is the current held quantity, unchanged by an adjustment — an adjustment moves
 * on-hand, not reservations — but it bounds how far on-hand may fall: the result must keep
 * `onHandTotal - reserved >= 0`. A delta that would break either rule is refused with the
 * reason, which the caller turns into a stock error rather than writing an impossible balance.
 *
 * A warehouse with no prior stock is treated as zero, so a first positive adjustment creates
 * its entry; an adjustment that brings a warehouse back to exactly zero drops the key, keeping
 * the map free of `0` entries the schema would otherwise carry forever.
 */
export function applyStockDelta(
  stock: StockByWarehouse,
  warehouseId: string,
  delta: number,
  reserved: number,
): ApplyStockDeltaResult {
  const current = stock[warehouseId] ?? 0;
  const nextAtWarehouse = current + delta;

  if (nextAtWarehouse < 0) {
    return { ok: false, reason: 'negative_warehouse_stock' };
  }

  // Rebuild the map without the target key, then re-add it only if it holds stock — this
  // drops a warehouse that returns to zero without a dynamic `delete`, keeping the map free of
  // `0` entries the schema would otherwise carry forever.
  const nextStock: Record<string, number> = Object.fromEntries(
    Object.entries(stock).filter(([code]) => code !== warehouseId),
  );
  if (nextAtWarehouse > 0) {
    nextStock[warehouseId] = nextAtWarehouse;
  }

  const onHandTotal = Object.values(nextStock).reduce((total, units) => total + units, 0);

  if (onHandTotal - reserved < 0) {
    return { ok: false, reason: 'oversell' };
  }

  return { ok: true, next: { stock: nextStock, onHandTotal } };
}

/**
 * Whether a variant crosses into or out of the low-stock band on this adjustment.
 *
 * Returns which threshold event, if any, the adjustment should emit: `low_stock` when
 * available falls to at-or-below the threshold from above it, `out_of_stock` when it reaches
 * zero from above, and `null` when the band did not change. Comparing before and after — not
 * just the after — is what stops a re-emission on every adjustment while a variant sits below
 * the threshold; the event fires on the crossing, not on the state.
 */
export function stockThresholdCrossing(
  before: { readonly available: number },
  after: { readonly available: number },
  lowStockThreshold: number,
): 'low_stock' | 'out_of_stock' | null {
  if (after.available <= 0 && before.available > 0) return 'out_of_stock';
  if (after.available <= lowStockThreshold && before.available > lowStockThreshold) {
    return 'low_stock';
  }
  return null;
}
