import { z } from 'zod';

import { createStateMachine } from '../state-machine';

/**
 * Product publication state.
 *
 * `archived` rather than deletion: a product referenced by an order's immutable
 * item snapshot must remain resolvable for invoices and reorder flows, so nothing
 * in the catalogue is ever hard-deleted.
 */
export const ProductStatusSchema = z.enum(['draft', 'active', 'archived']);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

/** Only `active` is publicly readable. Drafts are invisible to customers. */
export const PUBLICLY_VISIBLE_PRODUCT_STATUSES: readonly ProductStatus[] = Object.freeze([
  'active',
]);

/**
 * Archiving is reversible — a seasonal line comes back — but going straight from
 * `archived` to `active` is not allowed. It has to pass back through `draft`, where
 * pricing, stock and media get a second look before customers can buy it again.
 */
export const productStatusMachine = createStateMachine('product status', {
  draft: ['active', 'archived'],
  active: ['draft', 'archived'],
  archived: ['draft'],
} satisfies Record<ProductStatus, readonly ProductStatus[]>);

/**
 * Age band.
 *
 * A string, not a union. Bands are store configuration (ADR-0005) — a second store
 * may sell to a different age range, and baking `'3-5'` into a type would make the
 * catalogue's shape a property of the code rather than of the store. Validated
 * against the configured list at the boundary instead.
 */
export const AgeBandSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[\w+-]+$/, { error: 'An age band looks like "3-5" or "8+".' })
  .brand<'AgeBand'>();
export type AgeBand = z.infer<typeof AgeBandSchema>;
