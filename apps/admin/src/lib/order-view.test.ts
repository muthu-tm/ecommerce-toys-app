import { describe, expect, it } from 'vitest';

import { FulfilmentStatusSchema, OrderStatusSchema } from '@romp/contracts';

import {
  fulfilmentStatusLabel,
  fulfilmentStatusTone,
  orderEventLabel,
  orderStatusLabel,
  orderStatusTone,
} from './order-view';

/**
 * The status view helpers are exhaustive over both machines, so a new status cannot be added without
 * a label and a tone — the assertion that catches a fall-through default that looks fine.
 */

describe('order status view', () => {
  it('has a label and a tone for every payment status', () => {
    for (const status of OrderStatusSchema.options) {
      expect(orderStatusLabel(status)).not.toBe('');
      expect(typeof orderStatusTone(status)).toBe('string');
    }
  });

  it('marks paid as success and rejected as danger', () => {
    expect(orderStatusTone('paid')).toBe('success');
    expect(orderStatusTone('payment_rejected')).toBe('danger');
    expect(orderStatusLabel('pending_verification')).toBe('Pending verification');
  });
});

describe('fulfilment status view', () => {
  it('has a label and a tone for every fulfilment status', () => {
    for (const status of FulfilmentStatusSchema.options) {
      expect(fulfilmentStatusLabel(status)).not.toBe('');
      expect(typeof fulfilmentStatusTone(status)).toBe('string');
    }
  });

  it('marks delivered as success and cancelled as danger', () => {
    expect(fulfilmentStatusTone('delivered')).toBe('success');
    expect(fulfilmentStatusTone('cancelled')).toBe('danger');
  });
});

describe('orderEventLabel', () => {
  it('humanises known event types', () => {
    expect(orderEventLabel('order.payment_verified')).toBe('Payment verified');
    expect(orderEventLabel('order.shipped')).toBe('Shipped');
    expect(orderEventLabel('refund.issued')).toBe('Refund issued');
  });

  it('falls back to the raw type for an unknown event', () => {
    expect(orderEventLabel('some.new_event')).toBe('some.new_event');
  });
});
