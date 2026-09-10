import { z } from 'zod';

import { SkuSchema } from '../primitives/identifiers';
import { ProductIdSchema, UidSchema, VariantIdSchema } from '../primitives/ids';
import { InstantSchema, NullableInstantSchema } from '../primitives/instant';
import { MoneySchema } from '../primitives/money';

/**
 * A line in a cart.
 *
 * Every `…Snapshot` field is for **display continuity only**. The charged amount
 * always comes from a fresh server quote at checkout, which is what stops a stale
 * snapshot from becoming a stale price. Without the snapshots the cart page would
 * need a product read per line just to render a name, and with them the cart
 * renders from one document.
 *
 * This is also why carts are API-written and not client-written even though
 * client-written would be less code: a client that can write `priceMinorSnapshot`
 * and a checkout that trusted it would let the browser choose the price.
 */
export const CartItemSchema = z.object({
  variantId: VariantIdSchema,
  productId: ProductIdSchema,
  sku: SkuSchema,
  qty: z.int().positive(),
  priceMinorSnapshot: MoneySchema,
  nameSnapshot: z.string().min(1).max(200),
  variantNameSnapshot: z.string().min(1).max(120),
  /** Storage object path of the cover image, not a download URL. */
  imagePathSnapshot: z.string().min(1).max(1_024).nullable(),
  addedAt: InstantSchema,
});
export type CartItem = z.infer<typeof CartItemSchema>;

/**
 * `carts/{cartId}`.
 *
 * `cartId` is the uid for a signed-in customer and an opaque cookie ID for an
 * anonymous one. Using the uid directly means a customer has exactly one cart with
 * no lookup, and it makes the security rule a path comparison rather than a field
 * comparison.
 */
export const CartDocSchema = z
  .object({
    ownerType: z.enum(['user', 'anonymous']),
    userId: UidSchema.nullable(),
    items: z.array(CartItemSchema),
    giftWrap: z.boolean(),
    updatedAt: InstantSchema,
    /**
     * Anonymous carts expire and a Firestore TTL policy removes them. Null for a
     * signed-in customer's cart, which lives as long as the account — an
     * abandoned cart that vanishes is a lost order.
     */
    expiresAt: NullableInstantSchema,
  })
  .refine((cart) => (cart.ownerType === 'user') === (cart.userId !== null), {
    error: 'A user cart carries its uid; an anonymous cart does not have one.',
    path: ['userId'],
  })
  .refine((cart) => cart.ownerType === 'user' || cart.expiresAt !== null, {
    // An anonymous cart with no expiry is an unbounded collection with no owner
    // who will ever clear it.
    error: 'An anonymous cart must expire.',
    path: ['expiresAt'],
  })
  .refine(
    (cart) => {
      const variantIds = cart.items.map((item) => item.variantId);
      return new Set(variantIds).size === variantIds.length;
    },
    {
      // Two lines for the same variant means the quantity ceiling is bypassable by
      // adding the item twice, and the cart total disagrees with what a quote
      // returns.
      error: 'A variant appears at most once in a cart; adding again increases the quantity.',
      path: ['items'],
    },
  );
export type CartDoc = z.infer<typeof CartDocSchema>;
