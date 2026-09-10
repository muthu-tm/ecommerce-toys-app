import { z } from 'zod';

import { ProductIdSchema, VariantIdSchema } from '../primitives/ids';
import { MoneySchema } from '../primitives/money';

/**
 * The cart wire contracts.
 *
 * A cart is written through the API and never by the client, so these requests carry only what the
 * server needs to resolve the truth — a variant to add and a quantity — not a price or a computed
 * line. The server reads the variant, refreshes its price and availability, enforces the ceilings,
 * and returns a `CartView`: what to render, with a freshly computed subtotal that is display-only.
 * The charged amount comes from the checkout quote, never from here.
 */

/**
 * Add a variant to the cart, or set its quantity.
 *
 * `productId` and `variantId` both cross the wire because a variant lives in a product's
 * subcollection — the server addresses it by both, and the product-detail page that raises this
 * request already knows both. `mode` is `add` (increment the existing line) or `set` (replace the
 * line's quantity, for a cart-page quantity control). `qty` is a positive whole number; the
 * server caps it at the lower of available stock and the per-line ceiling.
 */
export const AddCartItemRequestSchema = z.object({
  productId: ProductIdSchema,
  variantId: VariantIdSchema,
  qty: z.int().positive().max(1_000),
  mode: z.enum(['add', 'set']),
});
export type AddCartItemRequest = z.infer<typeof AddCartItemRequestSchema>;

/** Toggle gift wrap on the cart. */
export const UpdateCartRequestSchema = z.object({
  giftWrap: z.boolean(),
});
export type UpdateCartRequest = z.infer<typeof UpdateCartRequestSchema>;

/**
 * A cart line, as the storefront renders it.
 *
 * The snapshots (name, variant name, image) come straight from the stored line; `lineSubtotalMinor`
 * is `qty × priceMinorSnapshot`, recomputed on read; `inStock` is refreshed from live availability,
 * so a line whose stock vanished shows as unavailable without a count — the exact number is
 * staff-only. No `available` figure crosses this wire.
 */
export const CartLineViewSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  sku: z.string(),
  qty: z.int().positive(),
  priceMinorSnapshot: MoneySchema,
  nameSnapshot: z.string(),
  variantNameSnapshot: z.string(),
  imagePathSnapshot: z.string().nullable(),
  lineSubtotalMinor: MoneySchema,
  inStock: z.boolean(),
});
export type CartLineView = z.infer<typeof CartLineViewSchema>;

/**
 * The cart as the storefront renders it — the response of a read and of every mutation.
 *
 * `itemCount` is the total unit count (the header badge); `subtotalMinor` is the sum of the line
 * subtotals. Both are display-only: the authoritative total is the checkout quote, which recomputes
 * from scratch. Returning the whole view from a mutation means the client never has to re-fetch to
 * reflect its own change.
 */
export const CartViewSchema = z.object({
  items: z.array(CartLineViewSchema),
  giftWrap: z.boolean(),
  itemCount: z.int().nonnegative(),
  subtotalMinor: MoneySchema,
});
export type CartView = z.infer<typeof CartViewSchema>;
