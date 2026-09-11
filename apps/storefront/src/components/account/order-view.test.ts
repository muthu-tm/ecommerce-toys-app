import { describe, expect, it } from 'vitest';

import { FulfilmentStatusSchema, OrderStatusSchema } from '@romp/contracts';

import { fulfilmentStatusLabel, orderStatusLabel, orderStatusTone } from './order-view';

/**
 * The customer status view helpers are exhaustive over both machines, so a new status cannot ship
 * without a customer-readable label and a tone.
 */

describe('customer order status view', () => {
  it('labels and tones every payment status', () => {
    for (const status of OrderStatusSchema.options) {
      expect(orderStatusLabel(status)).not.toBe('');
      expect(typeof orderStatusTone(status)).toBe('string');
    }
  });

  it('labels every fulfilment status in the customer’s vocabulary', () => {
    for (const status of FulfilmentStatusSchema.options) {
      expect(fulfilmentStatusLabel(status)).not.toBe('');
    }
    expect(fulfilmentStatusLabel('shipped')).toBe('On its way');
    expect(fulfilmentStatusLabel('unfulfilled')).toBe('Preparing');
  });
});
