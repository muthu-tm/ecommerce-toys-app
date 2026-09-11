import { z } from 'zod';

import { FulfilmentStatusSchema, OrderStatusSchema } from '../domain/order';
import { NOTE_REQUIRED_REASONS, RefundModeSchema, RefundReasonSchema } from '../domain/refund';
import { HumanOrderIdSchema } from '../primitives/identifiers';
import { OrderIdSchema, RefundIdSchema } from '../primitives/ids';
import { MoneySchema } from '../primitives/money';
import { pagedSchema, PageRequestSchema } from '../primitives/pagination';

import { OrderViewSchema } from './orders';

/**
 * The admin order-and-money wire contracts.
 *
 * These back the backoffice actions that settle an order: verifying a payment (which commits stock
 * and marks the order paid), rejecting one (which sends the customer back to resubmit), and issuing a
 * refund (the one money-outward action, owner-only). The requests carry only the operator's
 * decision — an amount they read from the bank, a reason, a refund's shape — never anything the
 * system already knows about the order, which it reads server-side.
 */

/**
 * Verify a payment against an order.
 *
 * `paidAmountMinor` is the amount the operator read from the bank statement, in paise. The server
 * compares it to the order total **exactly** — a short or over payment is refused with both figures,
 * never accepted as "close enough" — so this is the one field the decision turns on. Nothing about
 * the order's own amounts crosses the wire: they are not the operator's to assert.
 */
export const VerifyPaymentRequestSchema = z.object({
  paidAmountMinor: MoneySchema,
});
export type VerifyPaymentRequest = z.infer<typeof VerifyPaymentRequestSchema>;

/**
 * Reject a payment the operator could not match.
 *
 * The `reason` is shown to the customer, who may then correct the reference and resubmit — so it has
 * to say something they can act on, which is why it is required rather than optional.
 */
export const RejectPaymentRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectPaymentRequest = z.infer<typeof RejectPaymentRequestSchema>;

/**
 * The order after a verification or rejection — the full customer-facing view, so the backoffice
 * re-renders the order's new state (paid, or rejected with the reason) without a second read.
 */
export const AdminOrderActionResponseSchema = OrderViewSchema;
export type AdminOrderActionResponse = z.infer<typeof AdminOrderActionResponseSchema>;

/**
 * Issue a refund against a paid order.
 *
 * `amountMinor` is authoritative and must be positive — a refund of zero is not a refund, and the
 * server caps the running total at the order total. `mode` is the operator's label (a full refund vs
 * a partial one); the order moves to `refunded` when the whole total has been returned regardless of
 * the label. `outwardUpiRef` is the reference of the transfer the operator makes, and may be null
 * while the record is created ahead of the transfer. `restock` decides whether the units return to
 * sellable stock — a suggestion is offered by reason, but the operator makes the call (damaged goods
 * come back but are not resellable). `note` is required for the reasons the enum alone does not
 * explain.
 */
export const IssueRefundRequestSchema = z
  .object({
    orderId: OrderIdSchema,
    mode: RefundModeSchema,
    amountMinor: MoneySchema.refine((amount) => amount > 0, {
      error: 'A refund of zero is not a refund.',
    }),
    reason: RefundReasonSchema,
    note: z.string().min(1).max(1_000).nullable(),
    /** The reference of the money sent back; raw as typed, the server normalises it. Null until paid. */
    outwardUpiRef: z.string().min(1).max(128).nullable(),
    restock: z.boolean(),
  })
  .refine((refund) => !NOTE_REQUIRED_REASONS.includes(refund.reason) || refund.note !== null, {
    error: 'This refund reason needs a note explaining the decision.',
    path: ['note'],
  });
export type IssueRefundRequest = z.infer<typeof IssueRefundRequestSchema>;

/**
 * The result of issuing a refund.
 *
 * `refundedMinor` is the order's running refunded total after this refund, and `status` is `refunded`
 * once it reaches the order total — enough for the backoffice to reflect the outcome without
 * re-reading the order.
 */
export const IssueRefundResponseSchema = z.object({
  refundId: RefundIdSchema,
  orderId: OrderIdSchema,
  status: z.enum(['paid', 'refunded']),
  refundedMinor: MoneySchema,
});
export type IssueRefundResponse = z.infer<typeof IssueRefundResponseSchema>;

/**
 * List orders for the backoffice — a filterable, cursor-paginated query.
 *
 * `status` and `fulfilmentStatus` are alternatives, not a matrix: the backoffice filters by one
 * dimension at a time, and combining them would need an index the query plan does not carry, so the
 * server applies at most one (payment status wins). `humanId` is the search box — an exact
 * customer-facing number that short-circuits the filters and pagination to return that one order.
 * `limit` and `cursor` are the standard page controls; the cursor is opaque and echoed back.
 */
export const AdminOrderListRequestSchema = PageRequestSchema.extend({
  status: OrderStatusSchema.optional(),
  fulfilmentStatus: FulfilmentStatusSchema.optional(),
  humanId: HumanOrderIdSchema.optional(),
});
export type AdminOrderListRequest = z.input<typeof AdminOrderListRequestSchema>;
export type ResolvedAdminOrderListRequest = z.output<typeof AdminOrderListRequestSchema>;

/** A page of orders as the backoffice renders them — the same customer-facing view, plus a cursor. */
export const AdminOrderListResponseSchema = pagedSchema(OrderViewSchema);
export type AdminOrderListResponse = z.infer<typeof AdminOrderListResponseSchema>;

/**
 * Advance an order's fulfilment to the next stage.
 *
 * `status` is the target stage. `carrier` and `trackingNo` are required when shipping — the schema
 * refuses a `shipped` request without them, mirroring the order document's own invariant, because
 * the "your order shipped" notification interpolates both. `holdReason` is required when placing an
 * order on hold; it is shown to staff, not the customer. The other fields are ignored for stages
 * that do not use them, so a UI can send the same shape for every action.
 */
export const FulfilmentRequestSchema = z
  .object({
    status: FulfilmentStatusSchema,
    carrier: z.string().min(1).max(100).nullable().default(null),
    trackingNo: z.string().min(1).max(100).nullable().default(null),
    holdReason: z.string().min(1).max(500).nullable().default(null),
  })
  .refine(
    (body) => body.status !== 'shipped' || (body.carrier !== null && body.trackingNo !== null),
    {
      error: 'Shipping an order needs a carrier and a tracking number.',
      path: ['trackingNo'],
    },
  )
  .refine((body) => body.status !== 'on_hold' || body.holdReason !== null, {
    error: 'Placing an order on hold needs a reason.',
    path: ['holdReason'],
  });
export type FulfilmentRequest = z.infer<typeof FulfilmentRequestSchema>;

/**
 * Cancel an order.
 *
 * The `reason` is recorded on the audit trail and is a customer-facing fact (unlike a hold reason),
 * so it is required. `restock` decides whether a paid order's committed units return to sellable
 * stock — it is ignored for a pre-payment cancel, whose held units are released regardless because
 * they never left on-hand.
 */
export const CancelOrderRequestSchema = z.object({
  reason: z.string().min(1).max(500),
  restock: z.boolean().default(false),
});
export type CancelOrderRequest = z.input<typeof CancelOrderRequestSchema>;

/** The order after a fulfilment advance or a cancellation — the full customer-facing view. */
export const AdminOrderMutationResponseSchema = OrderViewSchema;
export type AdminOrderMutationResponse = z.infer<typeof AdminOrderMutationResponseSchema>;
