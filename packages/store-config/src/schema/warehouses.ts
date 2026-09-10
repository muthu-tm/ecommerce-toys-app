import { z } from 'zod';

/**
 * Warehouses, seeded into Firestore.
 *
 * One or many. The count is **data**: the admin inventory UI iterates this list, so
 * nothing in the UI assumes a number. A single-warehouse store and a five-warehouse
 * store run the same code.
 */
export const WarehouseConfigSchema = z.object({
  /** Becomes the Firestore document ID, so it is a lowercase natural key. */
  code: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/u, {
    error: 'A warehouse code is lowercase alphanumeric with hyphens, e.g. "blr".',
  }),
  name: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  pincode: z.string().regex(/^[1-9]\d{5}$/u, { error: 'Must be a 6-digit PIN code.' }),
  /** Allocation order. Lower wins, so the nearest or cheapest warehouse ships first. */
  priority: z.int().min(0).max(1_000),
  active: z.boolean(),
  /**
   * PIN prefixes this warehouse serves, used by the delivery estimate. Prefixes
   * rather than full codes because India has ~19,000 of them and a prefix covers a
   * region.
   */
  servicePincodePrefixes: z.array(z.string().regex(/^[1-9]\d{0,5}$/u)).min(1),
});
export type WarehouseConfig = z.infer<typeof WarehouseConfigSchema>;

export const WarehousesSchema = z
  .array(WarehouseConfigSchema)
  .min(1, { error: 'A store needs at least one warehouse to allocate stock from.' })
  .refine(
    (warehouses) =>
      new Set(warehouses.map((warehouse) => warehouse.code)).size === warehouses.length,
    { error: 'Warehouse codes must be unique — they are Firestore document IDs.' },
  )
  .refine((warehouses) => warehouses.some((warehouse) => warehouse.active), {
    error: 'At least one warehouse must be active, or no order can ever be allocated.',
  });
