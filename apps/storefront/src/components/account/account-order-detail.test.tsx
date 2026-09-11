import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrderView } from '@romp/contracts';

import { contact } from '@/lib/store';

/**
 * The account order detail renders the order and, crucially for Task 20, a WhatsApp support link
 * pre-filled with the order's human number. `@/lib/order-api` and `@/lib/auth-context` are mocked.
 */

const get = vi.hoisted(() => vi.fn<() => Promise<OrderView>>());
const auth = vi.hoisted((): { current: { uid: string | null; ready: boolean } } => ({
  current: { uid: 'cust-1', ready: true },
}));

vi.mock('@/lib/order-api', () => ({
  orderApi: { get },
  OrderApiError: class OrderApiError extends Error {
    status: number;
    constructor(status: number, _code: string, detail: string) {
      super(detail);
      this.status = status;
    }
  },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.current }));

const { AccountOrderDetail } = await import('./AccountOrderDetail');

const order = (): OrderView => ({
  orderId: 'order-1' as OrderView['orderId'],
  humanId: 'RMP-24817' as OrderView['humanId'],
  status: 'paid',
  fulfilment: {
    status: 'shipped',
    carrier: 'Delhivery',
    trackingNo: 'DL123',
    packedAt: new Date(),
    shippedAt: new Date(),
    deliveredAt: null,
    holdReason: null,
  },
  items: [
    {
      productId: 'wooden-blocks' as OrderView['items'][number]['productId'],
      variantId: 'WB-240' as OrderView['items'][number]['variantId'],
      sku: 'WB-240' as OrderView['items'][number]['sku'],
      name: 'Wooden blocks',
      variantName: '240 pieces',
      imagePath: null,
      unitPriceMinor: 100_000 as OrderView['items'][number]['unitPriceMinor'],
      qty: 1,
      lineTotalMinor: 100_000 as OrderView['items'][number]['lineTotalMinor'],
    },
  ],
  amounts: {
    subtotalMinor: 100_000 as OrderView['amounts']['subtotalMinor'],
    giftWrapMinor: 0 as OrderView['amounts']['giftWrapMinor'],
    shippingMinor: 0 as OrderView['amounts']['shippingMinor'],
    taxMinor: 0 as OrderView['amounts']['taxMinor'],
    totalMinor: 100_000 as OrderView['amounts']['totalMinor'],
    refundedMinor: 0 as OrderView['amounts']['refundedMinor'],
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
});

beforeEach(() => {
  get.mockReset();
  auth.current = { uid: 'cust-1', ready: true };
});

describe('AccountOrderDetail', () => {
  it('renders the order and a WhatsApp link pre-filled with the order number', async () => {
    get.mockResolvedValue(order());
    render(<AccountOrderDetail orderId="order-1" />);

    expect(await screen.findByRole('heading', { name: 'RMP-24817' })).toBeInTheDocument();

    const support = screen.getByRole('link', { name: /chat about this order on whatsapp/iu });
    const href = support.getAttribute('href') ?? '';
    expect(href).toContain(`wa.me/${contact.whatsappNumber.replace('+', '')}`);
    // The order's human number is interpolated into the pre-filled message (URL-encoded).
    expect(decodeURIComponent(href)).toContain('RMP-24817');
  });

  it('shows tracking for a shipped order', async () => {
    get.mockResolvedValue(order());
    render(<AccountOrderDetail orderId="order-1" />);
    expect(await screen.findByText(/Delhivery/u)).toBeInTheDocument();
    expect(screen.getByText(/On its way/u)).toBeInTheDocument();
  });

  it('shows the signed-out prompt when there is no customer', () => {
    auth.current = { uid: null, ready: true };
    render(<AccountOrderDetail orderId="order-1" />);
    expect(screen.getByText(/sign in to see this order/iu)).toBeInTheDocument();
  });

  it('shows a not-found message for a foreign or missing order', async () => {
    const { OrderApiError } = await import('@/lib/order-api');
    get.mockRejectedValue(new OrderApiError(404, 'NOT_FOUND', 'nope'));
    render(<AccountOrderDetail orderId="order-1" />);
    await waitFor(() => {
      expect(screen.getByText(/could not find that order/iu)).toBeInTheDocument();
    });
  });
});
