import { z } from 'zod';

import { BasisPointsSchema } from '../primitives/basis-points';
import { UpiVpaSchema } from '../primitives/identifiers';
import { ActorIdSchema } from '../primitives/ids';
import { InstantSchema } from '../primitives/instant';
import { MoneySchema } from '../primitives/money';

/**
 * `settings/checkout`.
 *
 * Runtime-editable commerce parameters, **seeded** from store config. The config
 * file is the initial value and the disaster-recovery reference; this document is
 * the live source. A fee change should not require a release, and a release should
 * not silently revert a fee change — which is why the seed writes this document
 * only when it does not already exist.
 *
 * Publicly readable, deliberately. Every value here is something the customer is
 * shown before they pay: the shipping threshold, the gift-wrap fee, the UPI VPA
 * they are about to send money to. A UPI VPA is a payee address, not a secret —
 * it is printed on shop counters. Nothing secret lives in Firestore.
 */
export const CheckoutSettingsDocSchema = z
  .object({
    /**
     * How long a reservation holds stock while the customer pays. Bounded: too
     * short and customers lose orders mid-payment, too long and unpaid orders sit
     * on stock all day.
     */
    reservationTtlMinutes: z.int().min(5).max(720),
    giftWrapFeeMinor: MoneySchema,
    expressFeeMinor: MoneySchema,
    /** Order subtotals at or above this ship free. */
    freeShippingThresholdMinor: MoneySchema,
    /** Flat shipping charge below the free threshold. */
    standardShippingFeeMinor: MoneySchema,
    /** GST in **basis points** — an integer, for the same reason money is (ADR-0004). */
    gstRateBasisPoints: BasisPointsSchema,
    upi: z.object({
      vpa: UpiVpaSchema,
      /** Payee name encoded in the QR. What the customer sees in their UPI app. */
      payeeName: z.string().min(1).max(100),
    }),
    /** Default per-variant low-stock threshold for newly created variants. */
    lowStockThreshold: z.int().nonnegative(),
    updatedAt: InstantSchema,
    updatedBy: ActorIdSchema,
  })
  .refine(
    (settings) =>
      settings.freeShippingThresholdMinor === 0 || settings.standardShippingFeeMinor > 0,
    {
      // A free-shipping threshold with no shipping fee below it advertises a
      // benefit that does not exist.
      error: 'A free-shipping threshold only means something if shipping is otherwise charged.',
      path: ['standardShippingFeeMinor'],
    },
  );
export type CheckoutSettingsDoc = z.infer<typeof CheckoutSettingsDocSchema>;

/** The one settings document ID that is publicly readable. */
export const CHECKOUT_SETTINGS_ID = 'checkout';

/**
 * `analytics/daily/{yyyy-mm-dd}`.
 *
 * A scheduled rollup, so the admin dashboard never scans `orders`. Staff-only:
 * revenue is not a public figure.
 *
 * `aovMinor` is stored rather than derived at read time because the dashboard
 * charts it across a date range, and deriving it per point means every consumer
 * has to agree on what happens when `paidCount` is zero.
 */
export const DailyAnalyticsDocSchema = z
  .object({
    /** The date this row covers, as `yyyy-mm-dd` in the store's timezone. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'A rollup date is yyyy-mm-dd.' }),
    revenueMinor: MoneySchema,
    orderCount: z.int().nonnegative(),
    paidCount: z.int().nonnegative(),
    rejectedCount: z.int().nonnegative(),
    refundedMinor: MoneySchema,
    /** Average order value across paid orders. Zero when there were none. */
    aovMinor: MoneySchema,
    computedAt: InstantSchema,
  })
  .refine((row) => row.paidCount <= row.orderCount, {
    error: 'Paid orders are a subset of orders placed.',
    path: ['paidCount'],
  })
  .refine((row) => row.paidCount > 0 || row.aovMinor === 0, {
    error: 'With no paid orders the average order value is zero, not a carried-forward figure.',
    path: ['aovMinor'],
  });
export type DailyAnalyticsDoc = z.infer<typeof DailyAnalyticsDocSchema>;
