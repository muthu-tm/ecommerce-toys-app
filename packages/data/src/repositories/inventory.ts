import type { InventoryDoc, InventoryLedgerDoc, ReservationDoc } from '@romp/contracts';
import { availableStock } from '@romp/contracts';

import type { Caller, StoreContext } from '../context';
import { isStaff, requireStaff } from '../context';
import type { WithId } from '../converter';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

import { getDocument, getDocuments, runQuery } from './read';

/**
 * Inventory reads.
 *
 * Two audiences with different rights, and the split matters. **Availability** is a
 * derived boolean that the storefront needs on every product page. **Stock** is exact
 * per-warehouse counts, which are commercially sensitive and staff-only
 * (`SECURITY.md` read matrix).
 *
 * So the functions returning documents all require staff, and the functions returning
 * availability do not. A single `getInventory` that customers could call and read a
 * count from would defeat the distinction, which is why there isn't one.
 *
 * Nothing here writes. Stock movements are transactions that also write a ledger entry
 * explaining them, and those live with the order and adjustment flows that own the
 * invariant.
 */

/** Availability for one variant, with no counts attached. */
export interface Availability {
  readonly variantId: string;
  readonly inStock: boolean;
  /**
   * Units a new order could reserve right now.
   *
   * **Staff-only.** Null for a customer-facing caller, so this type can be returned
   * from one function to both audiences without the caller having to remember to strip
   * a field. An optional field would be forgotten; a null that is always present is not.
   */
  readonly available: number | null;
}

/**
 * Availability for a set of variants.
 *
 * The one inventory read a customer-facing page may perform. `inStock` is computed from
 * `onHandTotal - reserved`, so a variant whose entire stock is held by unpaid orders
 * reads as unavailable — which is the honest answer, because a customer who added it
 * would fail at checkout.
 *
 * A missing inventory document means no record exists yet, which is genuinely no stock.
 * Not an error: a variant created a moment ago has no inventory record until the first
 * adjustment.
 */
export async function getAvailability(
  ctx: StoreContext,
  caller: Caller,
  variantIds: readonly string[],
): Promise<readonly Availability[]> {
  if (variantIds.length === 0) return [];

  const records = await getDocuments(
    ctx,
    variantIds.map((variantId) => paths.inventory(variantId)),
    converters.inventory,
  );
  const byVariant = new Map(records.map((record) => [record.id, record]));
  const maySeeCounts = isStaff(caller);

  return variantIds.map((variantId) => {
    const record = byVariant.get(variantId);
    const available =
      record === undefined ? 0 : availableStock(record.onHandTotal, record.reserved);

    return {
      variantId,
      inStock: available > 0,
      available: maySeeCounts ? available : null,
    };
  });
}

/** Availability for a single variant. */
export async function getVariantAvailability(
  ctx: StoreContext,
  caller: Caller,
  variantId: string,
): Promise<Availability> {
  const [availability] = await getAvailability(ctx, caller, [variantId]);

  // `getAvailability` returns one entry per requested ID, so this cannot be undefined.
  // Falling back rather than asserting keeps the function total.
  return availability ?? { variantId, inStock: false, available: null };
}

/**
 * The full inventory record, staff only.
 *
 * This is the read that exposes per-warehouse counts, and it is the reason
 * `getAvailability` exists separately.
 */
export async function findInventory(
  ctx: StoreContext,
  caller: Caller,
  variantId: string,
): Promise<WithId<InventoryDoc> | null> {
  requireStaff(caller, { resource: 'inventory' });

  return getDocument(ctx, paths.inventory(variantId), converters.inventory);
}

/**
 * Variants at or below their low-stock threshold.
 *
 * Firestore cannot compare two fields in a query — `onHandTotal <= lowStockThreshold` is
 * not expressible — so this reads the low end of the collection ordered by
 * `onHandTotal` and filters in memory. Bounded by `scanLimit`, which is what makes the
 * cost predictable rather than proportional to the catalogue.
 *
 * That bound is a real limitation, stated rather than hidden: a store whose entire
 * catalogue sits below its thresholds would have the report truncated. The alternative —
 * a denormalised `isLowStock` boolean maintained by every inventory transaction — is the
 * right answer when this report matters more than it does today.
 */
export async function listLowStock(
  ctx: StoreContext,
  caller: Caller,
  options: { readonly scanLimit?: number } = {},
): Promise<readonly WithId<InventoryDoc>[]> {
  requireStaff(caller, { resource: 'inventory' });

  const candidates = await runQuery(
    ctx.db
      .collection(COLLECTIONS.inventory)
      .withConverter(converters.inventory)
      .orderBy('onHandTotal', 'asc')
      .limit(options.scanLimit ?? 200),
  );

  return candidates.filter(
    (record) => availableStock(record.onHandTotal, record.reserved) <= record.lowStockThreshold,
  );
}

/**
 * Reservations past their expiry that still hold stock — the sweeper's work list.
 *
 * `expiresAt <= now` with `status == 'active'`, index-backed, oldest first. The sweeper
 * releases these; its **non-execution** is the alerting condition, because a stalled
 * sweeper throws nothing while leaking stock indefinitely (`RUNBOOKS.md` runbook 2).
 *
 * `now` comes from the context clock rather than `new Date()`, so a test can place the
 * boundary exactly instead of sleeping.
 */
export async function listExpiredReservations(
  ctx: StoreContext,
  caller: Caller,
  options: { readonly limit?: number } = {},
): Promise<readonly WithId<ReservationDoc>[]> {
  requireStaff(caller, { resource: 'reservations' });

  return runQuery(
    ctx.db
      .collection(COLLECTIONS.reservations)
      .withConverter(converters.reservations)
      .where('status', '==', 'active')
      .where('expiresAt', '<=', ctx.clock.now())
      .orderBy('expiresAt', 'asc')
      .limit(options.limit ?? 100),
  );
}

/**
 * The age of the oldest unresolved expired reservation, in milliseconds.
 *
 * This is the number the sweeper alert watches. **Backlog age, not error rate** — a
 * sweeper that has crashed emits no errors at all, so an error-rate alert on it is an
 * alert that fires only when the sweeper is working well enough to fail (ADR-0007,
 * `SECURITY.md` § oversell).
 *
 * Returns null when nothing is overdue, which is the healthy state and is deliberately
 * not zero: zero and "nothing to measure" would otherwise be the same reading.
 */
export async function oldestExpiredReservationAgeMs(
  ctx: StoreContext,
  caller: Caller,
): Promise<number | null> {
  const [oldest] = await listExpiredReservations(ctx, caller, { limit: 1 });
  if (oldest === undefined) return null;

  return ctx.clock.now().getTime() - oldest.expiresAt.getTime();
}

/**
 * The live reservation for an order, if it still holds stock.
 *
 * `active` only. A `committed` reservation has already moved its units out of `reserved`
 * and a `released` one has given them back, so neither is holding anything — and a
 * caller asking this question is asking what would be freed if the order were cancelled.
 */
export async function findActiveReservationForOrder(
  ctx: StoreContext,
  caller: Caller,
  orderId: string,
): Promise<WithId<ReservationDoc> | null> {
  requireStaff(caller, { resource: 'reservations' });

  const results = await runQuery(
    ctx.db
      .collection(COLLECTIONS.reservations)
      .withConverter(converters.reservations)
      .where('orderId', '==', orderId)
      .where('status', '==', 'active')
      .limit(1),
  );

  return results[0] ?? null;
}

/**
 * The ledger for one variant, newest first.
 *
 * The ledger is the source of truth for stock *movement*; `inventory.stock` is a
 * materialised balance. When they disagree the ledger wins and the balance is wrong,
 * which is the only reason the reconciliation runbook can exist.
 */
export async function listLedgerForVariant(
  ctx: StoreContext,
  caller: Caller,
  variantId: string,
  options: { readonly limit?: number } = {},
): Promise<readonly WithId<InventoryLedgerDoc>[]> {
  requireStaff(caller, { resource: 'inventoryLedger' });

  return runQuery(
    ctx.db
      .collection(COLLECTIONS.inventoryLedger)
      .withConverter(converters.inventoryLedger)
      .where('variantId', '==', variantId)
      .orderBy('at', 'desc')
      .limit(options.limit ?? 100),
  );
}

/**
 * Reconciles the ledger against the materialised balance for one variant.
 *
 * The operational half of the invariant that `@romp/data`'s seed tests assert: the
 * signed ledger deltas per warehouse must sum to `inventory.stock`. This is what
 * runbook 4 needs in order to answer "is the balance wrong, or is my count wrong".
 *
 * Reads the **whole** ledger for the variant, not a page of it. A partial sum would
 * report a discrepancy that is an artefact of the page size, which is worse than no
 * report — it would send someone counting shelves over nothing.
 */
export async function reconcileVariantStock(
  ctx: StoreContext,
  caller: Caller,
  variantId: string,
): Promise<{
  readonly variantId: string;
  readonly balanced: boolean;
  readonly ledgerByWarehouse: Readonly<Record<string, number>>;
  readonly storedByWarehouse: Readonly<Record<string, number>>;
  readonly entryCount: number;
}> {
  requireStaff(caller, { resource: 'inventoryLedger' });

  const [record, entries] = await Promise.all([
    getDocument(ctx, paths.inventory(variantId), converters.inventory),
    runQuery(
      ctx.db
        .collection(COLLECTIONS.inventoryLedger)
        .withConverter(converters.inventoryLedger)
        .where('variantId', '==', variantId)
        .orderBy('at', 'asc'),
    ),
  ]);

  const ledgerByWarehouse: Record<string, number> = {};
  for (const entry of entries) {
    ledgerByWarehouse[entry.warehouseId] =
      (ledgerByWarehouse[entry.warehouseId] ?? 0) + entry.delta;
  }

  const storedByWarehouse: Record<string, number> = { ...(record?.stock ?? {}) };

  // Compare over the union of both key sets. Comparing only the stored keys would miss a
  // warehouse the ledger knows about and the balance has dropped, which is exactly the
  // discrepancy most worth finding.
  const warehouses = new Set([
    ...Object.keys(ledgerByWarehouse),
    ...Object.keys(storedByWarehouse),
  ]);
  const balanced = [...warehouses].every(
    (warehouseId) =>
      (ledgerByWarehouse[warehouseId] ?? 0) === (storedByWarehouse[warehouseId] ?? 0),
  );

  return {
    variantId,
    balanced,
    ledgerByWarehouse,
    storedByWarehouse,
    entryCount: entries.length,
  };
}
