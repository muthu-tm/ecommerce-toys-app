import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrderView, SubmitPaymentProofResponse } from '@romp/contracts';

/**
 * The order confirmation body. The concern is that it fetches the order, renders the UPI QR from the
 * order's payload with the exact total, lists the items, drives the payment-proof submission by
 * order status (form while awaiting, under-review once submitted, rejection reason when rejected),
 * and surfaces the API's message when the order cannot be read.
 */

const get = vi.hoisted(() => vi.fn<() => Promise<OrderView>>());
const submitPaymentProof = vi.hoisted(() => vi.fn<() => Promise<SubmitPaymentProofResponse>>());
const qr = vi.hoisted(() => vi.fn());

vi.mock('@/lib/order-api', () => ({
  orderApi: { get, quote: vi.fn(), place: vi.fn(), submitPaymentProof },
  OrderApiError: class OrderApiError extends Error {
    constructor(_status: number, _code: string, detail: string) {
      super(detail);
    }
  },
}));
// Render the QR as a marker element carrying its encoded value, so the test can assert what was
// encoded without depending on the SVG the real component draws.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: { value: string; title?: string }) => {
    qr(props.value);
    return <div data-testid="upi-qr" data-value={props.value} title={props.title} />;
  },
}));

const { OrderConfirmation } = await import('./OrderConfirmation');

const anOrder = (overrides: Partial<OrderView> = {}): OrderView =>
  ({
    orderId: 'order-abc',
    humanId: 'RMP-1000',
    status: 'awaiting_payment',
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
        productId: 'wooden-blocks',
        variantId: 'v1',
        sku: 'v1',
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
      giftWrapMinor: 0,
      shippingMinor: 0,
      taxMinor: 36_000,
      totalMinor: 2_36_000,
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
    deliverySpeed: 'standard',
    isGift: false,
    giftMessage: null,
    payment: {
      method: 'upi',
      upiRef: null,
      screenshotPath: null,
      qrPayload: 'upi://pay?pa=store@bank&pn=Store&am=2360.00&tn=RMP-1000&cu=INR',
      submittedAt: null,
      verifiedBy: null,
      verifiedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
    createdAt: new Date('2026-09-09T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:00.000Z'),
    ...overrides,
  }) as unknown as OrderView;

beforeEach(() => {
  get.mockReset();
  submitPaymentProof.mockReset();
  qr.mockReset();
});

describe('OrderConfirmation', () => {
  it('renders the order number, the UPI QR from the payload, and the total', async () => {
    get.mockResolvedValue(anOrder());
    render(<OrderConfirmation orderId="order-abc" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /order rmp-1000/iu })).toBeInTheDocument();
    });
    // The QR encodes exactly the server-minted payload.
    expect(qr).toHaveBeenCalledWith(
      'upi://pay?pa=store@bank&pn=Store&am=2360.00&tn=RMP-1000&cu=INR',
    );
    expect(screen.getByTestId('upi-qr').getAttribute('data-value')).toContain('tn=RMP-1000');
    // The total appears (₹2,360).
    expect(screen.getAllByText(/2,360/u).length).toBeGreaterThan(0);
    expect(screen.getByText(/Wooden blocks/u)).toBeInTheDocument();
  });

  it('submits a UPI reference and re-renders as under-review', async () => {
    get.mockResolvedValue(anOrder());
    submitPaymentProof.mockResolvedValue({
      orderId: 'order-abc',
      status: 'pending_verification',
      submittedAt: new Date(),
    } as unknown as SubmitPaymentProofResponse);
    const user = userEvent.setup();
    render(<OrderConfirmation orderId="order-abc" />);

    await waitFor(() => {
      expect(screen.getByTestId('upi-qr')).toBeInTheDocument();
    });

    await user.type(screen.getByRole('textbox', { name: /reference/iu }), '412398765432');
    await user.click(screen.getByRole('button', { name: /submit payment reference/iu }));

    await waitFor(() => {
      expect(submitPaymentProof).toHaveBeenCalledWith('order-abc', {
        upiRef: '412398765432',
        screenshotPath: null,
      });
    });
    // Re-rendered as pending_verification: the form is gone, the under-review headline shows.
    await waitFor(() => {
      expect(screen.getByText(/checking your payment/iu)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /submit payment reference/iu }),
    ).not.toBeInTheDocument();
  });

  it('shows an under-review message with no form when already pending verification', async () => {
    get.mockResolvedValue(anOrder({ status: 'pending_verification' }));
    render(<OrderConfirmation orderId="order-abc" />);
    await waitFor(() => {
      expect(screen.getByText(/checking your payment/iu)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /submit payment reference/iu }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('upi-qr')).not.toBeInTheDocument();
  });

  it('shows the rejection reason and allows resubmission when payment was rejected', async () => {
    get.mockResolvedValue(
      anOrder({
        status: 'payment_rejected',
        payment: {
          ...anOrder().payment,
          rejectedBy: 'staff-1',
          rejectedAt: new Date(),
          rejectionReason: 'The reference did not match any payment.',
        },
      } as Partial<OrderView>),
    );
    render(<OrderConfirmation orderId="order-abc" />);
    await waitFor(() => {
      expect(screen.getByText(/did not match any payment/iu)).toBeInTheDocument();
    });
    // The form is available again for a resubmission.
    expect(screen.getByRole('button', { name: /submit payment reference/iu })).toBeInTheDocument();
  });

  it('surfaces the API message when the order cannot be read', async () => {
    const { OrderApiError } = await import('@/lib/order-api');
    get.mockRejectedValue(new OrderApiError(404, 'NOT_FOUND', 'Not found.'));
    render(<OrderConfirmation orderId="missing" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/not found/iu);
    });
  });
});
