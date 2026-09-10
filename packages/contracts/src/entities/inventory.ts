import { z } from 'zod';

import { InventoryLedgerReasonSchema } from '../domain/inventory';
import { ReservationStatusSchema } from '../domain/reservation';
import { PincodeSchema } from '../primitives/identifiers';
import {
  ActorIdSchema,
  OrderIdSchema,
  ProductIdSchema,
  VariantIdSchema,
  WarehouseIdSchema,
} from '../primitives/ids';
import { InstantSchema, NullableInstantSchema } from '../primitives/instant';

/**
 * `warehouses/{warehouseId}` — document ID is the `code`.
 *
 * Seeded from store config, one or many. The count is **data**: the admin
 * inventory UI iterates this collection, so a single-warehouse store and a
 * five-warehouse store run the same code with no branch between them.
 */
export const WarehouseDocSchema = z.object({
  /** Duplicates the document ID. Stored so a query result is self-describing. */
  code: WarehouseIdSchema,
  name: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  pincode: PincodeSchema,
  /** Allocation order. Lower wins. */
  priority: z.int().nonnegative(),
  /** Inactive warehouses are excluded from allocation and from delivery estimates. */
  active: z.boolean(),
  /**
   * PIN **prefixes** this warehouse serves. Prefixes rather than full codes
   * because India has roughly 19 000 of them and a prefix covers a region.
   */
  servicePincodePrefixes: z.array(z.string().regex(/^[1-9]\d{0,5}$/)).min(1),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type WarehouseDoc = z.infer<typeof WarehouseDocSchema>;

/**
 * `inventory/{variantId}` — the document ID **is** the variant ID.
 *
 * One record per variant, so a checkout transaction touches exactly one document
 * per line item. Keying by variant rather than by `(variant, warehouse)` is what
 * makes the "is there enough anywhere" question a single read instead of a query,
 * and a Firestore transaction cannot be built on a query result that might grow
 * between attempts.
 */
export const InventoryDocSchema = z
  .object({
    productId: ProductIdSchema,
    /** On-hand units per warehouse. Absent key means no stock at that warehouse. */
    stock: z.record(WarehouseIdSchema, z.int().nonnegative()),
    /** Denormalised sum of `stock`. Owner: every inventory transaction. */
    onHandTotal: z.int().nonnegative(),
    /** Held by unexpired reservations, not yet committed. */
    reserved: z.int().nonnegative(),
    /** Crossing this emits `inventory.low_stock`. Seeded from `commerce.lowStockThreshold`. */
    lowStockThreshold: z.int().nonnegative(),
    updatedAt: InstantSchema,
  })
  .refine(
    (inventory) =>
      Object.values(inventory.stock).reduce((total, units) => total + units, 0) ===
      inventory.onHandTotal,
    {
      // The denormalised total is what every availability check reads. If it can
      // disagree with the per-warehouse map, the check is meaningless — so the
      // disagreement fails on read rather than quietly overselling.
      error: 'onHandTotal must equal the sum of per-warehouse stock.',
      path: ['onHandTotal'],
    },
  )
  .refine((inventory) => inventory.onHandTotal - inventory.reserved >= 0, {
    error: 'Reserved units cannot exceed on-hand stock — this is the oversell invariant.',
    path: ['reserved'],
  });
export type InventoryDoc = z.infer<typeof InventoryDocSchema>;

/**
 * `inventoryLedger/{entryId}` — append-only.
 *
 * The ledger is the source of truth for stock *movement*; `inventory.stock` is a
 * materialised balance. When they disagree the ledger wins and the balance is
 * wrong, which is the only reason the reconciliation runbook can exist.
 *
 * Corrections are compensating entries, never edits, so what was believed and
 * when survives.
 */
export const InventoryLedgerDocSchema = z.object({
  variantId: VariantIdSchema,
  productId: ProductIdSchema,
  warehouseId: WarehouseIdSchema,
  /** Signed. Negative removes stock. */
  delta: z.int(),
  reason: InventoryLedgerReasonSchema,
  /** Admin uid, or `'system'` for the sweeper and the seed. */
  actorId: ActorIdSchema,
  /** Order ID, refund ID, or null for a manual adjustment. */
  refId: z.string().min(1).max(1_500).nullable(),
  /** Free-text explanation. Required for adjustments, where the reason enum is not enough. */
  note: z.string().min(1).max(500).nullable(),
  at: InstantSchema,
});
export type InventoryLedgerDoc = z.infer<typeof InventoryLedgerDocSchema>;

/** One variant's share of a reservation, and which warehouses will supply it. */
export const ReservationItemSchema = z
  .object({
    variantId: VariantIdSchema,
    qty: z.int().positive(),
    /** Per-warehouse allocation. Must sum to `qty`. */
    allocation: z.record(WarehouseIdSchema, z.int().positive()),
  })
  .refine(
    (item) =>
      Object.values(item.allocation).reduce((total, units) => total + units, 0) === item.qty,
    {
      // A reservation whose allocation does not add up to its quantity will
      // release the wrong number of units when it expires, and the leak is silent.
      error: 'The warehouse allocation must sum to the reserved quantity.',
      path: ['allocation'],
    },
  );
export type ReservationItem = z.infer<typeof ReservationItemSchema>;

/**
 * `reservations/{reservationId}`.
 *
 * **Invariant** — no reservation stays `active` past `expiresAt`. The sweeper
 * guarantees this, and its *non-execution* is the alerting condition: a stalled
 * sweeper throws nothing while leaking stock indefinitely.
 */
export const ReservationDocSchema = z
  .object({
    orderId: OrderIdSchema,
    items: z.array(ReservationItemSchema).min(1),
    status: ReservationStatusSchema,
    /** `createdAt + settings.checkout.reservationTtlMinutes`. */
    expiresAt: InstantSchema,
    createdAt: InstantSchema,
    /** Set when the reservation is committed or released. Null while active. */
    resolvedAt: NullableInstantSchema,
  })
  .refine(
    (reservation) => (reservation.status === 'active') === (reservation.resolvedAt === null),
    {
      error: 'A resolved reservation records when, and an active one has not resolved.',
      path: ['resolvedAt'],
    },
  )
  .refine((reservation) => reservation.expiresAt.getTime() > reservation.createdAt.getTime(), {
    error: 'A reservation cannot expire before it is created.',
    path: ['expiresAt'],
  });
export type ReservationDoc = z.infer<typeof ReservationDocSchema>;
