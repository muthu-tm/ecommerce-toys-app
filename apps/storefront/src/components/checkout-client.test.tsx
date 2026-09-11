import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckoutQuoteResponse, PlaceOrderResponse } from '@romp/contracts';

import type { CheckoutSession } from '@/lib/use-checkout';

/**
 * The checkout page body. The concern is that it renders the address picker and delivery choice,
 * fetches a quote from the API and shows the recomputed total, and places the order — navigating to
 * the confirmation page — while degrading to sign-in / add-address states when those upstream
 * pieces are absent.
 */

const quote = vi.hoisted(() => vi.fn<() => Promise<CheckoutQuoteResponse>>());
const place = vi.hoisted(() => vi.fn<() => Promise<PlaceOrderResponse>>());
const push = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ current: {} as CheckoutSession }));

vi.mock('@/lib/order-api', () => ({
  orderApi: { quote, place, get: vi.fn() },
  OrderApiError: class OrderApiError extends Error {
    constructor(_status: number, _code: string, detail: string) {
      super(detail);
    }
  },
}));
vi.mock('@/lib/use-checkout', () => ({
  useCheckoutSession: () => session.current,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const { CheckoutClient } = await import('./CheckoutClient');

const anAddress = (id: string, isDefault = false) => ({
  id,
  label: 'Home',
  recipientName: 'Asha Rao',
  line1: '1 MG Road',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  isDefault,
});

const aQuote = (): CheckoutQuoteResponse =>
  ({
    lines: [
      {
        productId: 'wooden-blocks',
        variantId: 'v1',
        name: 'Wooden blocks',
        variantName: '240 pieces',
        unitPriceMinor: 1_00_000,
        qty: 2,
        lineTotalMinor: 2_00_000,
      },
    ],
    giftWrap: false,
    subtotalMinor: 2_00_000,
    giftWrapMinor: 0,
    shippingMinor: 0,
    taxMinor: 36_000,
    totalMinor: 2_36_000,
  }) as unknown as CheckoutQuoteResponse;

beforeEach(() => {
  quote.mockReset();
  place.mockReset();
  push.mockReset();
  session.current = { uid: 'cust-1', ready: true, addresses: [anAddress('addr-1', true)] };
});

describe('CheckoutClient', () => {
  it('asks the visitor to sign in when signed out', () => {
    session.current = { uid: null, ready: true, addresses: [] };
    render(<CheckoutClient />);
    expect(screen.getByRole('heading', { name: /sign in to check out/iu })).toBeInTheDocument();
  });

  it('asks for an address when the customer has none saved', () => {
    session.current = { uid: 'cust-1', ready: true, addresses: [] };
    render(<CheckoutClient />);
    expect(screen.getByRole('heading', { name: /add a delivery address/iu })).toBeInTheDocument();
  });

  it('fetches a quote and shows the recomputed total', async () => {
    quote.mockResolvedValue(aQuote());
    render(<CheckoutClient />);
    await waitFor(() => {
      expect(quote).toHaveBeenCalledWith({ deliverySpeed: 'standard' });
    });
    // ₹2,360 total (₹2,000 + ₹360 tax).
    await waitFor(() => {
      expect(screen.getByTestId('checkout-total').textContent).toMatch(/2,360/u);
    });
  });

  it('re-quotes when the delivery speed changes', async () => {
    quote.mockResolvedValue(aQuote());
    const user = userEvent.setup();
    render(<CheckoutClient />);
    await waitFor(() => {
      expect(quote).toHaveBeenCalledWith({ deliverySpeed: 'standard' });
    });

    await user.click(screen.getByRole('radio', { name: /express/iu }));
    await waitFor(() => {
      expect(quote).toHaveBeenCalledWith({ deliverySpeed: 'express' });
    });
  });

  it('places the order and navigates to the confirmation page', async () => {
    quote.mockResolvedValue(aQuote());
    place.mockResolvedValue({ orderId: 'order-abc' } as unknown as PlaceOrderResponse);
    const user = userEvent.setup();
    render(<CheckoutClient />);
    await waitFor(() => {
      expect(screen.getByTestId('checkout-total')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /place order/iu }));

    await waitFor(() => {
      expect(place).toHaveBeenCalledWith(
        expect.objectContaining({ addressId: 'addr-1', deliverySpeed: 'standard', isGift: false }),
      );
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/orders/order-abc');
    });
  });

  it('surfaces a quote error and blocks placing', async () => {
    const { OrderApiError } = await import('@/lib/order-api');
    quote.mockRejectedValue(
      new OrderApiError(409, 'INVALID_STATE_TRANSITION', 'Your cart is empty.'),
    );
    render(<CheckoutClient />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/cart is empty/iu);
    });
    // With no quote, the place-order button is disabled.
    expect(screen.getByRole('button', { name: /place order/iu })).toBeDisabled();
  });
});
