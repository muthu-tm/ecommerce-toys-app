import { z } from 'zod';

import { DeliverySpeedSchema } from '../domain/order';
import { ProductIdSchema, VariantIdSchema } from '../primitives/ids';
import { MoneySchema } from '../primitives/money';

/**
 * The checkout-quote wire contracts.
 *
 * A quote is the authoritative price of the caller's cart at this instant: the server resolves the
 * caller's own cart server-side, refreshes each line's price from the live variant, and recomputes
 * every figure — subtotal, gift wrap, shipping, tax — from scratch. Nothing the client holds about
 * money is trusted, which is why the request carries only the delivery speed and never a cart or a
 * total. The response is display-only in the sense that it is recomputed again at placement; a
 * quote is a preview the customer sees before committing, not a promise the server later reads back.
 */

/**
 * Request a fresh quote for the caller's cart.
 *
 * The cart is not on the wire — it is the caller's own, read by uid on the server. Gift wrap is a
 * property of the cart (toggled through the cart endpoint), so it is not repeated here; only the
 * delivery speed, a checkout-time choice with no home on the cart, crosses.
 */
export const CheckoutQuoteRequestSchema = z.object({
  deliverySpeed: DeliverySpeedSchema,
});
export type CheckoutQuoteRequest = z.infer<typeof CheckoutQuoteRequestSchema>;

/**
 * One priced line of the quote.
 *
 * Prices are refreshed from the live variant, so `unitPriceMinor` here may differ from what the
 * cart last rendered — the quote is where the customer sees the current price before paying.
 * `lineTotalMinor` is `unitPriceMinor × qty`, recomputed on the server.
 */
export const CheckoutQuoteLineSchema = z
  .object({
    productId: ProductIdSchema,
    variantId: VariantIdSchema,
    name: z.string().min(1).max(200),
    variantName: z.string().min(1).max(120),
    unitPriceMinor: MoneySchema,
    qty: z.int().positive(),
    lineTotalMinor: MoneySchema,
  })
  .refine((line) => line.unitPriceMinor * line.qty === line.lineTotalMinor, {
    error: 'The line total must equal unit price times quantity.',
    path: ['lineTotalMinor'],
  });
export type CheckoutQuoteLine = z.infer<typeof CheckoutQuoteLineSchema>;

/**
 * The quote as the checkout page renders it.
 *
 * Every money field is recomputed by the server from live prices: `subtotalMinor` is the sum of the
 * line totals, `taxMinor` is GST on the full taxable value (subtotal plus gift wrap plus shipping),
 * and `totalMinor` is the sum of the four. `giftWrap` echoes the cart's flag so the page can show
 * the fee it produced.
 */
export const CheckoutQuoteResponseSchema = z
  .object({
    lines: z.array(CheckoutQuoteLineSchema).min(1),
    giftWrap: z.boolean(),
    subtotalMinor: MoneySchema,
    giftWrapMinor: MoneySchema,
    shippingMinor: MoneySchema,
    taxMinor: MoneySchema,
    totalMinor: MoneySchema,
  })
  .refine(
    (quote) =>
      quote.lines.reduce((total, line) => total + line.lineTotalMinor, 0) === quote.subtotalMinor,
    {
      error: 'The subtotal must equal the sum of the line totals.',
      path: ['subtotalMinor'],
    },
  )
  .refine(
    (quote) =>
      quote.subtotalMinor + quote.giftWrapMinor + quote.shippingMinor + quote.taxMinor ===
      quote.totalMinor,
    {
      error: 'The total must equal subtotal plus gift wrap plus shipping plus tax.',
      path: ['totalMinor'],
    },
  );
export type CheckoutQuoteResponse = z.infer<typeof CheckoutQuoteResponseSchema>;
