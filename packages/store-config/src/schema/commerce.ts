import { z } from 'zod';

import { MoneySchema, UpiVpaSchema } from '@romp/contracts';

/**
 * Commerce parameters.
 *
 * These **seed** `settings/checkout`, which is then editable in admin without a
 * deploy. The config is the initial value and the disaster-recovery reference, not
 * the live source — a fee change should not require a release.
 */
export const CommerceConfigSchema = z
  .object({
    upi: z.object({
      vpa: UpiVpaSchema,
      /** Payee name encoded in the QR. What the customer sees in their UPI app. */
      payeeName: z.string().min(1).max(100),
    }),
    /**
     * How long a stock reservation holds units while the customer pays.
     *
     * Bounded deliberately. Too short and customers lose orders mid-payment; too long
     * and unpaid orders sit on stock all day. The sweeper releases anything past this,
     * and its *non-execution* is the alerting condition.
     */
    reservationTtlMinutes: z.int().min(5).max(720),
    giftWrapFeeMinor: MoneySchema,
    expressFeeMinor: MoneySchema,
    /** Flat shipping charge on orders below the free-shipping threshold. */
    standardShippingFeeMinor: MoneySchema,
    /**
     * Order subtotals at or above this ship free. Zero means shipping is always free,
     * in which case `standardShippingFeeMinor` must be zero too — a threshold with no
     * charge behind it advertises a benefit that does not exist.
     */
    freeShippingThresholdMinor: MoneySchema,
    /** Default per-variant threshold that emits `inventory.low_stock`. */
    lowStockThreshold: z.int().min(0).max(1_000),
    /**
     * The most units of one variant a single cart line may hold.
     *
     * A ceiling independent of stock: even when a warehouse has hundreds, a cart line is
     * capped here, so a typo or a script cannot park an absurd quantity that then reserves
     * real stock at checkout. Available stock is the *other* ceiling — a line is capped at
     * whichever is lower — but this one exists so the limit does not depend on how much
     * happens to be in stock at the moment.
     */
    maxQtyPerLine: z.int().min(1).max(1_000),
  })
  .refine(
    (commerce) =>
      commerce.freeShippingThresholdMinor === 0 || commerce.standardShippingFeeMinor > 0,
    {
      error: 'A free-shipping threshold only means something if shipping is otherwise charged.',
      path: ['standardShippingFeeMinor'],
    },
  );
export type CommerceConfig = z.infer<typeof CommerceConfigSchema>;
