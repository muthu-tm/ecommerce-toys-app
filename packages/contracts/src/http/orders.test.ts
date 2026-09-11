import { describe, expect, it } from 'vitest';

import {
  OrderListResponseSchema,
  OrderViewSchema,
  PlaceOrderRequestSchema,
  PlaceOrderResponseSchema,
} from './orders';

/**
 * The order contracts. The concern is the boundary the placement route relies on: the request
 * carries an address and choices but nothing priced, and the response and view echo the
 * server-committed amounts consistently, so the confirmation page renders exactly what was charged.
 */

describe('PlaceOrderRequestSchema', () => {
  const body = {
    addressId: 'addr-1',
    deliverySpeed: 'standard' as const,
    isGift: false,
    giftMessage: null,
  };

  it('accepts a placement with an address and choices', () => {
    expect(PlaceOrderRequestSchema.safeParse(body).success).toBe(true);
  });

  it('accepts a gift with a message', () => {
    expect(
      PlaceOrderRequestSchema.safeParse({ ...body, isGift: true, giftMessage: 'Happy birthday' })
        .success,
    ).toBe(true);
  });

  it('rejects a gift message over the limit', () => {
    expect(
      PlaceOrderRequestSchema.safeParse({ ...body, giftMessage: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('rejects a missing address', () => {
    const { addressId: _omit, ...rest } = body;
    expect(PlaceOrderRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('ignores a total or lines the client tries to dictate', () => {
    const result = PlaceOrderRequestSchema.safeParse({
      ...body,
      totalMinor: 1,
      lines: [{ variantId: 'X', qty: 1 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('totalMinor' in result.data).toBe(false);
      expect('lines' in result.data).toBe(false);
    }
  });
});

describe('PlaceOrderResponseSchema', () => {
  const response = {
    orderId: 'order-abc',
    humanId: 'RMP-1000',
    qrPayload: 'upi://pay?pa=romp@bank&pn=Store&am=2419.00&tn=RMP-1000&cu=INR',
    amounts: {
      subtotalMinor: 2_00_000,
      giftWrapMinor: 5_000,
      shippingMinor: 0,
      taxMinor: 36_900,
      totalMinor: 2_41_900,
      refundedMinor: 0,
    },
    status: 'awaiting_payment' as const,
  };

  it('accepts a placed order', () => {
    expect(PlaceOrderResponseSchema.safeParse(response).success).toBe(true);
  });

  it('rejects a humanId that is not the customer-facing form', () => {
    expect(PlaceOrderResponseSchema.safeParse({ ...response, humanId: 'order-abc' }).success).toBe(
      false,
    );
  });

  it('rejects amounts whose total does not sum the parts', () => {
    expect(
      PlaceOrderResponseSchema.safeParse({
        ...response,
        amounts: { ...response.amounts, totalMinor: 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects an empty QR payload', () => {
    expect(PlaceOrderResponseSchema.safeParse({ ...response, qrPayload: '' }).success).toBe(false);
  });
});

describe('OrderViewSchema', () => {
  const view = {
    orderId: 'order-abc',
    humanId: 'RMP-1000',
    status: 'awaiting_payment' as const,
    fulfilment: {
      status: 'unfulfilled' as const,
      carrier: null,
      trackingNo: null,
      packedAt: null,
      shippedAt: null,
      deliveredAt: null,
      holdReason: null,
    },
    items: [
      {
        productId: 'wooden-blocks',
        variantId: 'WB-240',
        sku: 'WB-240',
        name: 'Wooden blocks',
        variantName: '240 pieces',
        imagePath: null,
        unitPriceMinor: 1_00_000,
        qty: 2,
        lineTotalMinor: 2_00_000,
      },
    ],
    amounts: {
      subtotalMinor: 2_00_000,
      giftWrapMinor: 5_000,
      shippingMinor: 0,
      taxMinor: 36_900,
      totalMinor: 2_41_900,
      refundedMinor: 0,
    },
    shippingAddress: {
      recipientName: 'Asha Rao',
      line1: '1 MG Road',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      phone: '+919845021174',
    },
    deliverySpeed: 'standard' as const,
    isGift: false,
    giftMessage: null,
    payment: {
      method: 'upi' as const,
      upiRef: null,
      screenshotPath: null,
      qrPayload: 'upi://pay?pa=romp@bank&pn=Store&am=2419.00&tn=RMP-1000&cu=INR',
      submittedAt: null,
      verifiedBy: null,
      verifiedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
    createdAt: new Date('2026-09-09T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:00.000Z'),
  };

  it('accepts a customer order view', () => {
    expect(OrderViewSchema.safeParse(view).success).toBe(true);
  });

  it('rejects a view with no items — an order always has at least one line', () => {
    expect(OrderViewSchema.safeParse({ ...view, items: [] }).success).toBe(false);
  });

  it('rejects a line total that is not price times quantity', () => {
    expect(
      OrderViewSchema.safeParse({
        ...view,
        items: [{ ...view.items[0], lineTotalMinor: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe('OrderListResponseSchema', () => {
  const view = {
    orderId: 'order-abc',
    humanId: 'RMP-1000',
    status: 'paid' as const,
    fulfilment: {
      status: 'unfulfilled' as const,
      carrier: null,
      trackingNo: null,
      packedAt: null,
      shippedAt: null,
      deliveredAt: null,
      holdReason: null,
    },
    items: [
      {
        productId: 'wooden-blocks',
        variantId: 'WB-240',
        sku: 'WB-240',
        name: 'Wooden blocks',
        variantName: '240 pieces',
        imagePath: null,
        unitPriceMinor: 1_00_000,
        qty: 2,
        lineTotalMinor: 2_00_000,
      },
    ],
    amounts: {
      subtotalMinor: 2_00_000,
      giftWrapMinor: 5_000,
      shippingMinor: 0,
      taxMinor: 36_900,
      totalMinor: 2_41_900,
      refundedMinor: 0,
    },
    shippingAddress: {
      recipientName: 'Asha Rao',
      line1: '1 MG Road',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      phone: '+919845021174',
    },
    deliverySpeed: 'standard' as const,
    isGift: false,
    giftMessage: null,
    payment: {
      method: 'upi' as const,
      upiRef: '412398765432',
      screenshotPath: null,
      qrPayload: 'upi://pay?pa=romp@bank&pn=Store&am=2419.00&tn=RMP-1000&cu=INR',
      submittedAt: new Date('2026-09-09T00:00:00.000Z'),
      verifiedBy: 'staff-uid-0001',
      verifiedAt: new Date('2026-09-09T00:00:00.000Z'),
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
    createdAt: new Date('2026-09-09T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:00.000Z'),
  };

  it('accepts an order history of one or more views', () => {
    expect(OrderListResponseSchema.safeParse({ orders: [view] }).success).toBe(true);
  });

  it('accepts an empty history', () => {
    expect(OrderListResponseSchema.safeParse({ orders: [] }).success).toBe(true);
  });

  it('rejects a malformed order in the list', () => {
    expect(OrderListResponseSchema.safeParse({ orders: [{ ...view, items: [] }] }).success).toBe(
      false,
    );
  });
});
