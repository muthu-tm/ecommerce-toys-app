import { z } from 'zod';

import { OrderStatusSchema } from '../domain/order';
import { OrderIdSchema } from '../primitives/ids';
import { InstantSchema } from '../primitives/instant';

/**
 * The payment-proof wire contracts.
 *
 * A customer pays through their own UPI app and quotes back the transaction reference (UTR); an
 * admin later matches it by hand. This is the request that records that claim. It carries the raw
 * reference — the server normalises it (uppercases, strips spaces) before storing it and before
 * using it as the global-uniqueness guard — and, optionally, the Storage path of a proof image the
 * client has already uploaded to its own `payment-proofs/{orderId}/{uid}/…` prefix (which the
 * storage rules gate to the owner). The request never carries an amount: the amount to match is the
 * one the order's QR already fixed.
 */

/**
 * Submit a payment reference (and optional proof) against an order.
 *
 * `upiRef` is the reference exactly as the customer read it from their bank app — spacing and case
 * are theirs to get wrong; the server normalises. The wire bound is generous (a reference can be up
 * to 128 characters before whitespace is stripped) because banks and PSPs differ, and rejecting a
 * genuine payment is worse than accepting an odd-looking one the admin will eyeball. `screenshotPath`
 * is the object path of an already-uploaded proof, or null for a reference-only submission.
 */
export const SubmitPaymentProofRequestSchema = z.object({
  upiRef: z.string().min(1).max(128),
  screenshotPath: z.string().min(1).max(1_024).nullable(),
});
export type SubmitPaymentProofRequest = z.infer<typeof SubmitPaymentProofRequestSchema>;

/**
 * The result of a payment-proof submission.
 *
 * The order is now `pending_verification` and sits in the admin queue; `submittedAt` is when the
 * claim was recorded. The normalised reference is deliberately **not** echoed — the customer sees
 * their own submission on the order, and the response's job is only to confirm the state moved.
 */
export const SubmitPaymentProofResponseSchema = z.object({
  orderId: OrderIdSchema,
  status: OrderStatusSchema,
  submittedAt: InstantSchema,
});
export type SubmitPaymentProofResponse = z.infer<typeof SubmitPaymentProofResponseSchema>;
