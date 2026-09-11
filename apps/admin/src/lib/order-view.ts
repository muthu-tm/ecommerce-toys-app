import type { FulfilmentStatus, OrderStatus } from '@romp/contracts';
import type { BadgeTone } from '@romp/ui';

/**
 * View helpers for rendering order and fulfilment status in the backoffice.
 *
 * Pure and tested: the mapping from a status to a badge tone and a human label drifts silently
 * otherwise — a new status with no case falls through to a default that looks fine — so it is
 * asserted rather than eyeballed. The two machines are separate (payment and fulfilment), so each
 * has its own mapping.
 */

/** The badge tone for each payment status. */
export function orderStatusTone(status: OrderStatus): BadgeTone {
  switch (status) {
    case 'paid':
      return 'success';
    case 'pending_verification':
      return 'warning';
    case 'payment_rejected':
      return 'danger';
    case 'awaiting_payment':
      return 'neutral';
    case 'refunded':
      return 'warning';
    case 'expired':
    case 'cancelled':
      return 'neutral';
  }
}

/** The human label for each payment status. */
export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'awaiting_payment':
      return 'Awaiting payment';
    case 'pending_verification':
      return 'Pending verification';
    case 'paid':
      return 'Paid';
    case 'payment_rejected':
      return 'Payment rejected';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'Cancelled';
    case 'refunded':
      return 'Refunded';
  }
}

/** The badge tone for each fulfilment status. */
export function fulfilmentStatusTone(status: FulfilmentStatus): BadgeTone {
  switch (status) {
    case 'delivered':
      return 'success';
    case 'shipped':
    case 'packed':
      return 'neutral';
    case 'on_hold':
      return 'warning';
    case 'unfulfilled':
      return 'neutral';
    case 'cancelled':
      return 'danger';
  }
}

/** The human label for each fulfilment status. */
export function fulfilmentStatusLabel(status: FulfilmentStatus): string {
  switch (status) {
    case 'unfulfilled':
      return 'Unfulfilled';
    case 'packed':
      return 'Packed';
    case 'shipped':
      return 'Shipped';
    case 'delivered':
      return 'Delivered';
    case 'on_hold':
      return 'On hold';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** A human label for an order-event type, for the audit timeline. Falls back to the raw type. */
export function orderEventLabel(type: string): string {
  const labels: Record<string, string> = {
    'order.created': 'Order placed',
    'order.payment_submitted': 'Payment reference submitted',
    'order.payment_verified': 'Payment verified',
    'order.payment_rejected': 'Payment rejected',
    'order.expired': 'Reservation expired',
    'order.packed': 'Packed',
    'order.shipped': 'Shipped',
    'order.delivered': 'Delivered',
    'order.cancelled': 'Cancelled',
    'refund.issued': 'Refund issued',
  };
  return labels[type] ?? type;
}
