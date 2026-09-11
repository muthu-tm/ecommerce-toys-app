import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrderListResponse } from '@romp/contracts';

const listOrders = vi.hoisted(() => vi.fn<() => Promise<OrderListResponse>>());
const auth = vi.hoisted((): { current: { uid: string | null; ready: boolean } } => ({
  current: { uid: 'cust-1', ready: true },
}));

vi.mock('@/lib/account-api', () => ({
  accountApi: { listOrders },
  AccountApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.current }));

const { OrderHistory } = await import('./OrderHistory');

const anOrder = (id: string, humanId: string) =>
  ({
    orderId: id,
    humanId,
    status: 'paid',
    fulfilment: {
      status: 'unfulfilled',
      carrier: null,
      trackingNo: null,
      packedAt: null,
      shippedAt: null,
      deliveredAt: null,
      holdReason: null,
    },
    items: [
      {
        productId: 'p',
        variantId: 'v',
        sku: 'v',
        name: 'Toy',
        variantName: 'One',
        imagePath: null,
        unitPriceMinor: 100_000,
        qty: 1,
        lineTotalMinor: 100_000,
      },
    ],
    amounts: {
      subtotalMinor: 100_000,
      giftWrapMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: 100_000,
      refundedMinor: 0,
    },
    shippingAddress: {
      recipientName: 'Asha',
      line1: '1 MG Road',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      phone: '+919845021174',
    },
    deliverySpeed: 'standard',
    isGift: false,
    giftMessage: null,
    payment: {
      method: 'upi',
      upiRef: null,
      screenshotPath: null,
      qrPayload: 'upi://pay',
      submittedAt: null,
      verifiedBy: null,
      verifiedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as OrderListResponse['orders'][number];

beforeEach(() => {
  listOrders.mockReset();
  auth.current = { uid: 'cust-1', ready: true };
});

describe('OrderHistory', () => {
  it('lists the customer’s orders linking to each detail', async () => {
    listOrders.mockResolvedValue({ orders: [anOrder('order-1', 'RMP-1001')] });
    render(<OrderHistory />);
    const link = await screen.findByRole('link', { name: /RMP-1001/u });
    expect(link).toHaveAttribute('href', '/account/orders/order-1');
  });

  it('shows the empty state when there are no orders', async () => {
    listOrders.mockResolvedValue({ orders: [] });
    render(<OrderHistory />);
    expect(await screen.findByText(/no orders yet/iu)).toBeInTheDocument();
  });

  it('shows the signed-out prompt', () => {
    auth.current = { uid: null, ready: true };
    render(<OrderHistory />);
    expect(screen.getByText(/sign in to see your orders/iu)).toBeInTheDocument();
  });
});
