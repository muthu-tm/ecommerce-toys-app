import { z } from 'zod';

import {
  DeliverySpeedSchema,
  FulfilmentStatusSchema,
  OrderStatusSchema,
  PaymentMethodSchema,
} from '../domain/order';
import {
  E164PhoneSchema,
  EmailSchema,
  HumanOrderIdSchema,
  SkuSchema,
  UtrSchema,
} from '../primitives/identifiers';
import {
  ActorIdSchema,
  OrderIdSchema,
  ProductIdSchema,
  ReservationIdSchema,
  UidSchema,
  VariantIdSchema,
  WarehouseIdSchema,
} from '../primitives/ids';
import { InstantSchema, NullableInstantSchema } from '../primitives/instant';
import { MoneySchema } from '../primitives/money';

import { PostalAddressSchema } from './common';

/**
 * An order line — an **immutable snapshot**, not a reference.
 *
 * Everything needed to reprint an invoice years later is copied in, because the
 * product may have been renamed, repriced, or archived since. A line that joined
 * back to the catalogue would show today's price against yesterday's payment,
 * which is the one thing an order record must never do.
 */
export const OrderItemSchema = z
  .object({
    productId: ProductIdSchema,
    variantId: VariantIdSchema,
    sku: SkuSchema,
    name: z.string().min(1).max(200),
    variantName: z.string().min(1).max(120),
    imagePath: z.string().min(1).max(1_024).nullable(),
    unitPriceMinor: MoneySchema,
    qty: z.int().positive(),
    lineTotalMinor: MoneySchema,
  })
  .refine((item) => item.unitPriceMinor * item.qty === item.lineTotalMinor, {
    error: 'The line total must equal unit price times quantity.',
    path: ['lineTotalMinor'],
  });
export type OrderItem = z.infer<typeof OrderItemSchema>;

/**
 * Order money, all integer paise (ADR-0004).
 *
 * `refundedMinor` is a running total on the order rather than a recomputation over
 * the `refunds` collection: the refund cap has to be checked inside the same
 * transaction that writes the refund, and a transaction cannot be built on an
 * aggregate query.
 */
export const OrderAmountsSchema = z
  .object({
    subtotalMinor: MoneySchema,
    giftWrapMinor: MoneySchema,
    shippingMinor: MoneySchema,
    taxMinor: MoneySchema,
    totalMinor: MoneySchema,
    refundedMinor: MoneySchema,
  })
  .refine(
    (amounts) =>
      amounts.subtotalMinor + amounts.giftWrapMinor + amounts.shippingMinor + amounts.taxMinor ===
      amounts.totalMinor,
    {
      error: 'The total must equal subtotal plus gift wrap plus shipping plus tax.',
      path: ['totalMinor'],
    },
  )
  .refine((amounts) => amounts.refundedMinor <= amounts.totalMinor, {
    error: 'Refunds cannot exceed the order total.',
    path: ['refundedMinor'],
  });
export type OrderAmounts = z.infer<typeof OrderAmountsSchema>;

/**
 * The UPI payment record.
 *
 * There is no gateway confirming money moved: an admin reads a UTR and a
 * screenshot and decides (`SECURITY.md § threat notes`). Every field here exists to
 * turn that decision into a two-field match rather than a judgement call —
 * `qrPayload` fixes the expected amount and reference up front, and `verifiedBy` /
 * `rejectedBy` name the human who is accountable.
 */
export const OrderPaymentSchema = z
  .object({
    method: PaymentMethodSchema,
    /** The customer's claimed transaction reference. Normalised. Null until submitted. */
    upiRef: UtrSchema.nullable(),
    /** Storage path of the proof image. Null if the customer submitted a reference only. */
    screenshotPath: z.string().min(1).max(1_024).nullable(),
    /** The exact UPI intent string encoded into the QR, including the amount. */
    qrPayload: z.string().min(1).max(2_048),
    submittedAt: NullableInstantSchema,
    verifiedBy: UidSchema.nullable(),
    verifiedAt: NullableInstantSchema,
    rejectedBy: UidSchema.nullable(),
    rejectedAt: NullableInstantSchema,
    rejectionReason: z.string().min(1).max(500).nullable(),
  })
  .refine((payment) => (payment.verifiedBy === null) === (payment.verifiedAt === null), {
    error: 'A verification records both who and when.',
    path: ['verifiedBy'],
  })
  .refine((payment) => (payment.rejectedBy === null) === (payment.rejectedAt === null), {
    error: 'A rejection records both who and when.',
    path: ['rejectedBy'],
  })
  .refine((payment) => payment.rejectedAt === null || payment.rejectionReason !== null, {
    // The customer is shown this reason and may resubmit. A rejection with no
    // reason is a dead end they cannot act on.
    error: 'A rejection needs a reason — the customer sees it and may resubmit.',
    path: ['rejectionReason'],
  })
  .refine((payment) => payment.upiRef === null || payment.submittedAt !== null, {
    error: 'A submitted payment reference records when it arrived.',
    path: ['submittedAt'],
  });
export type OrderPayment = z.infer<typeof OrderPaymentSchema>;

/** Fulfilment, tracked independently of payment. */
export const OrderFulfilmentSchema = z
  .object({
    status: FulfilmentStatusSchema,
    carrier: z.string().min(1).max(100).nullable(),
    trackingNo: z.string().min(1).max(100).nullable(),
    packedAt: NullableInstantSchema,
    shippedAt: NullableInstantSchema,
    deliveredAt: NullableInstantSchema,
    /** Why the order is on hold. Shown to staff, not to the customer. */
    holdReason: z.string().min(1).max(500).nullable(),
  })
  .refine(
    (fulfilment) =>
      fulfilment.shippedAt === null ||
      (fulfilment.carrier !== null && fulfilment.trackingNo !== null),
    {
      // `order.shipped` notification copy interpolates both. Without them the
      // customer gets "shipped with undefined".
      error: 'A shipped order carries its carrier and tracking number.',
      path: ['trackingNo'],
    },
  )
  .refine((fulfilment) => fulfilment.status !== 'on_hold' || fulfilment.holdReason !== null, {
    error: 'An order on hold records why.',
    path: ['holdReason'],
  });
export type OrderFulfilment = z.infer<typeof OrderFulfilmentSchema>;

/**
 * `orders/{orderId}`.
 *
 * The document ID is random. `humanId` is the sequential customer-facing number
 * from `counters/orderHumanId`, and keeping them separate is what stops a guessed
 * order number from addressing a document (`SECURITY.md § enumeration`).
 */
export const OrderDocSchema = z
  .object({
    humanId: HumanOrderIdSchema,
    userId: UidSchema,
    /** Contact snapshot at the time of ordering. **PII.** */
    contact: z.object({
      email: EmailSchema.nullable(),
      phone: E164PhoneSchema.nullable(),
    }),

    status: OrderStatusSchema,
    fulfilment: OrderFulfilmentSchema,

    /** Written once, never modified. */
    items: z.array(OrderItemSchema).min(1),
    amounts: OrderAmountsSchema,
    /** Written once, never modified. **PII.** */
    shippingAddress: PostalAddressSchema,

    deliverySpeed: DeliverySpeedSchema,
    /** Hides prices on the invoice. */
    isGift: z.boolean(),
    giftMessage: z.string().max(500).nullable(),

    payment: OrderPaymentSchema,

    reservationId: ReservationIdSchema.nullable(),
    /** Which warehouse ships what: `{ variantId: { warehouseId: qty } }`. */
    allocation: z.record(VariantIdSchema, z.record(WarehouseIdSchema, z.int().positive())),

    createdAt: InstantSchema,
    updatedAt: InstantSchema,
  })
  .refine(
    (order) =>
      order.items.reduce((total, item) => total + item.lineTotalMinor, 0) ===
      order.amounts.subtotalMinor,
    {
      error: 'The subtotal must equal the sum of the line totals.',
      path: ['amounts', 'subtotalMinor'],
    },
  )
  .refine((order) => order.status !== 'paid' || order.payment.verifiedBy !== null, {
    // Reaching `paid` without a recorded actor would leave "who marked this paid"
    // unanswerable, which is the single question the manual-payment audit exists
    // to answer.
    error: 'A paid order records the admin who verified the payment.',
    path: ['payment', 'verifiedBy'],
  })
  .refine((order) => order.status !== 'refunded' || order.amounts.refundedMinor > 0, {
    error: 'A refunded order has a refunded amount.',
    path: ['amounts', 'refundedMinor'],
  })
  .refine(
    (order) => {
      // The allocation is what a warehouse picks against. If it disagrees with the
      // ordered quantity — in either direction — someone ships the wrong number of
      // units, so both the key set and every total have to match.
      const ordered = new Map<string, number>(
        order.items.map((item) => [item.variantId as string, item.qty]),
      );
      const allocationEntries = Object.entries(order.allocation);
      if (allocationEntries.length !== ordered.size) return false;

      return allocationEntries.every(([variantId, byWarehouse]) => {
        const allocated = Object.values(byWarehouse).reduce((total, qty) => total + qty, 0);
        return ordered.get(variantId) === allocated;
      });
    },
    {
      error: 'Every ordered variant needs an allocation whose quantities match what was ordered.',
      path: ['allocation'],
    },
  );
export type OrderDoc = z.infer<typeof OrderDocSchema>;

/**
 * `orders/{orderId}/events/{eventId}`.
 *
 * The per-order audit trail, append-only and never deleted — this is the record
 * that answers "who marked this paid, and when". Customers can read it, so it
 * carries no internal notes: staff commentary belongs on the store-wide `events`
 * spine, which is staff-only.
 */
export const OrderEventDocSchema = z.object({
  orderId: OrderIdSchema,
  type: z.string().min(1).max(80),
  actorId: ActorIdSchema,
  actorRole: z.enum(['customer', 'staff', 'owner', 'system']),
  /** Type-specific detail. Deliberately loose — this is a log, not a contract. */
  payload: z.record(z.string(), z.unknown()),
  at: InstantSchema,
});
export type OrderEventDoc = z.infer<typeof OrderEventDocSchema>;

/**
 * `paymentRefGuards/{normalizedUtr}` — existence means the reference is claimed.
 *
 * Created in the same transaction as the payment-proof submission and `create`-only,
 * so the second use of a UTR fails on document existence rather than on a query
 * that could race. This is the entire mechanism behind
 * `DUPLICATE_PAYMENT_REFERENCE`.
 *
 * Server-only in rules: readable, it answers "is this UTR already in use", which
 * tells an attacker whether a reference they hold has been spent.
 */
export const PaymentRefGuardDocSchema = z.object({
  orderId: OrderIdSchema,
  /** The normalised reference, duplicated from the document ID for self-description. */
  upiRef: UtrSchema,
  claimedAt: InstantSchema,
});
export type PaymentRefGuardDoc = z.infer<typeof PaymentRefGuardDocSchema>;

/**
 * `counters/{counterId}`.
 *
 * `counters/orderHumanId` backs `orders.humanId`. Incremented inside the order
 * transaction, so the sequence has no gaps or duplicates even under parallel load
 * — which matters because the number is what a customer quotes in a WhatsApp
 * message.
 */
export const CounterDocSchema = z.object({
  value: z.int().nonnegative(),
  updatedAt: InstantSchema,
});
export type CounterDoc = z.infer<typeof CounterDocSchema>;
