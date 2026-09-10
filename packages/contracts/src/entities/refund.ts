import { z } from 'zod';

import { NOTE_REQUIRED_REASONS, RefundModeSchema, RefundReasonSchema } from '../domain/refund';
import { UtrSchema } from '../primitives/identifiers';
import { OrderIdSchema, UidSchema } from '../primitives/ids';
import { InstantSchema } from '../primitives/instant';
import { MoneySchema } from '../primitives/money';

/**
 * `refunds/{refundId}` — append-only.
 *
 * A refund never mutates the original order's amounts. The order carries a running
 * `amounts.refundedMinor` and the refund records what was sent back, so partial
 * refunds compose without any document being rewritten. Rewriting the order total
 * would make the invoice disagree with what the customer actually paid.
 *
 * `userId` is denormalised from the order. It is what makes "a customer may read
 * their own refunds" a rule a client read can satisfy: without it the rule needs a
 * `get()` on the order for every refund in the list, which costs a read per
 * document and fails closed if the order is unreadable for an unrelated reason.
 *
 * Issuing a refund requires the `owner` claim, not `staff` — it is the one action
 * that moves money outward.
 */
export const RefundDocSchema = z
  .object({
    orderId: OrderIdSchema,
    /** Denormalised from the order, so ownership is checkable without a join. */
    userId: UidSchema,
    mode: RefundModeSchema,
    amountMinor: MoneySchema,
    reason: RefundReasonSchema,
    /** Free-text detail. Required for the reasons where the enum is not explanation enough. */
    note: z.string().min(1).max(1_000).nullable(),
    /**
     * The reference of the money actually sent back, from the operator's UPI app.
     * Null while the refund is recorded but not yet paid out — the record is
     * created when the decision is made, because that decision is what needs
     * auditing, and the transfer follows.
     */
    outwardUpiRef: UtrSchema.nullable(),
    /** Whether the units went back into sellable stock. */
    restock: z.boolean(),
    createdBy: UidSchema,
    createdAt: InstantSchema,
  })
  .refine((refund) => refund.amountMinor > 0, {
    error: 'A refund of zero is not a refund.',
    path: ['amountMinor'],
  })
  .refine((refund) => !NOTE_REQUIRED_REASONS.includes(refund.reason) || refund.note !== null, {
    error: 'This refund reason needs a note explaining the decision.',
    path: ['note'],
  });
export type RefundDoc = z.infer<typeof RefundDocSchema>;
