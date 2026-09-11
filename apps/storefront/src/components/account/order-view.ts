import type { FulfilmentStatus, OrderStatus } from '@romp/contracts';
import type { BadgeTone } from '@romp/ui';

/**
 * Customer-facing view helpers for order status.
 *
 * Pure and exhaustive over both machines, so a new status cannot ship without a customer-readable
 * label and a tone. The copy is the customer's vocabulary ("Waiting for payment", "On its way"), not
 * the backoffice's — this is what a shopper sees on their own order.
 */

export function orderStatusTone(status: OrderStatus): BadgeTone {
  switch (status) {
    case 'paid':
      return 'success';
    case 'pending_verification':
    case 'awaiting_payment':
      return 'warning';
    case 'payment_rejected':
      return 'danger';
    case 'refunded':
      return 'warning';
    case 'expired':
    case 'cancelled':
      return 'neutral';
  }
}

export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'awaiting_payment':
      return 'Awaiting payment';
    case 'pending_verification':
      return 'Payment under review';
    case 'paid':
      return 'Paid';
    case 'payment_rejected':
      return 'Payment not matched';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'Cancelled';
    case 'refunded':
      return 'Refunded';
  }
}

export function fulfilmentStatusLabel(status: FulfilmentStatus): string {
  switch (status) {
    case 'unfulfilled':
      return 'Preparing';
    case 'packed':
      return 'Packed';
    case 'shipped':
      return 'On its way';
    case 'delivered':
      return 'Delivered';
    case 'on_hold':
      return 'On hold';
    case 'cancelled':
      return 'Cancelled';
  }
}
