import { describe, expect, it } from 'vitest';

import {
  AdminOrderListRequestSchema,
  CancelOrderRequestSchema,
  FulfilmentRequestSchema,
  IssueRefundRequestSchema,
  IssueRefundResponseSchema,
  RejectPaymentRequestSchema,
  VerifyPaymentRequestSchema,
} from './admin-orders';

/**
 * The admin order-and-money contracts. The concern is the boundary the routes rely on: a verify
 * carries an exact amount and nothing else, a reject carries a customer-visible reason, and a refund
 * carries a positive amount with a note where the reason demands one.
 */

describe('VerifyPaymentRequestSchema', () => {
  it('accepts an amount in paise', () => {
    expect(VerifyPaymentRequestSchema.safeParse({ paidAmountMinor: 2_90_976 }).success).toBe(true);
  });

  it('rejects a non-integer amount', () => {
    expect(VerifyPaymentRequestSchema.safeParse({ paidAmountMinor: 100.5 }).success).toBe(false);
  });

  it('rejects a missing amount', () => {
    expect(VerifyPaymentRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('RejectPaymentRequestSchema', () => {
  it('accepts a reason', () => {
    expect(
      RejectPaymentRequestSchema.safeParse({ reason: 'No matching payment found.' }).success,
    ).toBe(true);
  });

  it('rejects an empty reason', () => {
    expect(RejectPaymentRequestSchema.safeParse({ reason: '' }).success).toBe(false);
  });
});

describe('IssueRefundRequestSchema', () => {
  const base = {
    orderId: 'order-1',
    mode: 'full' as const,
    amountMinor: 2_90_976,
    reason: 'customer_cancelled' as const,
    note: null,
    outwardUpiRef: null,
    restock: true,
  };

  it('accepts a refund with a standard reason and no note', () => {
    expect(IssueRefundRequestSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a zero amount — a refund of zero is not a refund', () => {
    expect(IssueRefundRequestSchema.safeParse({ ...base, amountMinor: 0 }).success).toBe(false);
  });

  it('requires a note for reasons the enum does not explain', () => {
    expect(
      IssueRefundRequestSchema.safeParse({ ...base, reason: 'other', note: null }).success,
    ).toBe(false);
    expect(
      IssueRefundRequestSchema.safeParse({ ...base, reason: 'other', note: 'Goodwill gesture.' })
        .success,
    ).toBe(true);
  });

  it('accepts an outward reference and a partial mode', () => {
    expect(
      IssueRefundRequestSchema.safeParse({
        ...base,
        mode: 'partial',
        amountMinor: 1_00_000,
        outwardUpiRef: '512398765432',
      }).success,
    ).toBe(true);
  });
});

describe('IssueRefundResponseSchema', () => {
  it('accepts a refunded result', () => {
    expect(
      IssueRefundResponseSchema.safeParse({
        refundId: 'refund-1',
        orderId: 'order-1',
        status: 'refunded',
        refundedMinor: 2_90_976,
      }).success,
    ).toBe(true);
  });

  it('rejects a status outside paid/refunded', () => {
    expect(
      IssueRefundResponseSchema.safeParse({
        refundId: 'refund-1',
        orderId: 'order-1',
        status: 'expired',
        refundedMinor: 0,
      }).success,
    ).toBe(false);
  });
});

describe('AdminOrderListRequestSchema', () => {
  it('defaults to a page with no filters', () => {
    const parsed = AdminOrderListRequestSchema.parse({});
    expect(parsed.limit).toBe(24);
    expect(parsed.status).toBeUndefined();
    expect(parsed.fulfilmentStatus).toBeUndefined();
  });

  it('accepts a payment-status filter', () => {
    expect(AdminOrderListRequestSchema.safeParse({ status: 'paid' }).success).toBe(true);
  });

  it('accepts a fulfilment-status filter', () => {
    expect(AdminOrderListRequestSchema.safeParse({ fulfilmentStatus: 'shipped' }).success).toBe(
      true,
    );
  });

  it('accepts a humanId search', () => {
    expect(AdminOrderListRequestSchema.safeParse({ humanId: 'RMP-24817' }).success).toBe(true);
  });

  it('coerces the limit and caps it', () => {
    expect(AdminOrderListRequestSchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(AdminOrderListRequestSchema.parse({ limit: '10' }).limit).toBe(10);
  });

  it('rejects an unknown status', () => {
    expect(AdminOrderListRequestSchema.safeParse({ status: 'nope' }).success).toBe(false);
  });
});

describe('FulfilmentRequestSchema', () => {
  it('accepts packing with no extra fields', () => {
    expect(FulfilmentRequestSchema.safeParse({ status: 'packed' }).success).toBe(true);
  });

  it('requires carrier and tracking to ship', () => {
    expect(FulfilmentRequestSchema.safeParse({ status: 'shipped' }).success).toBe(false);
    expect(
      FulfilmentRequestSchema.safeParse({
        status: 'shipped',
        carrier: 'Delhivery',
        trackingNo: 'DL1',
      }).success,
    ).toBe(true);
  });

  it('requires a reason to place on hold', () => {
    expect(FulfilmentRequestSchema.safeParse({ status: 'on_hold' }).success).toBe(false);
    expect(
      FulfilmentRequestSchema.safeParse({ status: 'on_hold', holdReason: 'Awaiting stock.' })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown fulfilment status', () => {
    expect(FulfilmentRequestSchema.safeParse({ status: 'shipping' }).success).toBe(false);
  });
});

describe('CancelOrderRequestSchema', () => {
  it('requires a reason and defaults restock to false', () => {
    const parsed = CancelOrderRequestSchema.parse({ reason: 'Customer changed their mind.' });
    expect(parsed.restock).toBe(false);
  });

  it('rejects an empty reason', () => {
    expect(CancelOrderRequestSchema.safeParse({ reason: '' }).success).toBe(false);
  });

  it('accepts an explicit restock', () => {
    expect(CancelOrderRequestSchema.safeParse({ reason: 'Damaged.', restock: true }).success).toBe(
      true,
    );
  });
});
