import { z } from 'zod';

import { createStateMachine } from '../state-machine';

/**
 * Order lifecycle.
 *
 * Payment status and fulfilment status are **separate machines**, deliberately. A
 * paid order can be on hold; a delivered order can be refunded. Collapsing them
 * into one enum would force invented composite states like
 * `paid_but_on_hold_and_partially_refunded`, and every new operational reality
 * would multiply the set.
 */
export const OrderStatusSchema = z.enum([
  /** Order placed, stock reserved, UPI QR issued. Waiting for the customer to pay. */
  'awaiting_payment',
  /** Customer submitted a UTR. Waiting for an admin to verify it against the bank. */
  'pending_verification',
  /** An admin confirmed the money arrived. Stock is committed. */
  'paid',
  /** An admin could not match the payment. The customer may resubmit. */
  'payment_rejected',
  /** The reservation lapsed before payment. Stock released by the sweeper. */
  'expired',
  /** Cancelled by an admin or the customer before payment settled. */
  'cancelled',
  /** Money returned. Terminal — a further refund is a new refund record, not a state change. */
  'refunded',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/**
 * Note `payment_rejected → pending_verification`: rejection is not terminal,
 * because the common cause is a customer mistyping a UTR, and forcing them to
 * place a new order would release and re-reserve stock they have already paid for.
 *
 * Note also that `expired` and `cancelled` are terminal while `paid` is not — only
 * a paid order can be refunded, and that is the only edge out of `paid`.
 */
export const orderStatusMachine = createStateMachine('order status', {
  awaiting_payment: ['pending_verification', 'expired', 'cancelled'],
  pending_verification: ['paid', 'payment_rejected', 'cancelled'],
  payment_rejected: ['pending_verification', 'expired', 'cancelled'],
  paid: ['refunded', 'cancelled'],
  expired: [],
  cancelled: [],
  refunded: [],
} satisfies Record<OrderStatus, readonly OrderStatus[]>);

/** Statuses in which the order still holds a live stock reservation. */
export const RESERVATION_HOLDING_STATUSES: readonly OrderStatus[] = Object.freeze([
  'awaiting_payment',
  'pending_verification',
  'payment_rejected',
]);

/** Statuses an admin sees in the verification queue. */
export const AWAITING_ADMIN_ACTION_STATUSES: readonly OrderStatus[] = Object.freeze([
  'pending_verification',
]);

/**
 * Fulfilment lifecycle, independent of payment.
 *
 * `on_hold` exists because real operations need somewhere to put an order that is
 * paid but cannot ship — address unreachable, stock damaged, customer asked to
 * delay. Without it, the alternatives are cancelling a paid order or lying about
 * its state.
 */
export const FulfilmentStatusSchema = z.enum([
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'on_hold',
  'cancelled',
]);
export type FulfilmentStatus = z.infer<typeof FulfilmentStatusSchema>;

/**
 * `shipped` cannot go back to `packed`, and `delivered` is terminal apart from
 * nothing: once a parcel is with the customer, a correction is a return or a
 * refund, which are separate records. Rewriting fulfilment history to fix a
 * mis-click would destroy the delivery audit trail.
 */
export const fulfilmentStatusMachine = createStateMachine('fulfilment status', {
  unfulfilled: ['packed', 'on_hold', 'cancelled'],
  packed: ['shipped', 'on_hold', 'cancelled'],
  shipped: ['delivered', 'on_hold'],
  on_hold: ['unfulfilled', 'packed', 'shipped', 'cancelled'],
  delivered: [],
  cancelled: [],
} satisfies Record<FulfilmentStatus, readonly FulfilmentStatus[]>);

/** UPI is the only method in v1.0. An enum rather than a literal so adding one is additive. */
export const PaymentMethodSchema = z.enum(['upi']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const DeliverySpeedSchema = z.enum(['standard', 'express']);
export type DeliverySpeed = z.infer<typeof DeliverySpeedSchema>;
