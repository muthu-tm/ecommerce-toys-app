import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The order actions offer only the fulfilment moves the machine permits, gate packing on payment,
 * and surface the API's own message. `@/lib/api` is mocked so the browser Firebase SDK it
 * transitively imports never loads in jsdom, and `next/navigation` is mocked for the refresh.
 */

const advanceFulfilment = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
const cancelOrderApi = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  adminApi: { advanceFulfilment, cancelOrder: cancelOrderApi },
  ApiError: class ApiError extends Error {
    code: string;
    constructor(_status: number, code: string, detail: string) {
      super(detail);
      this.code = code;
    }
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const { OrderActions } = await import('./OrderActions');

beforeEach(() => {
  advanceFulfilment.mockClear();
  cancelOrderApi.mockClear();
  refresh.mockClear();
});

describe('OrderActions — fulfilment gating', () => {
  it('offers packing for a paid, unfulfilled order', () => {
    render(<OrderActions orderId="o1" orderStatus="paid" fulfilmentStatus="unfulfilled" />);
    expect(screen.getByRole('button', { name: 'Mark packed' })).toBeInTheDocument();
  });

  it('hides packing for an order that is not yet paid', () => {
    render(
      <OrderActions
        orderId="o1"
        orderStatus="pending_verification"
        fulfilmentStatus="unfulfilled"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Mark packed' })).not.toBeInTheDocument();
  });

  it('collects a carrier and tracking number when shipping is possible', () => {
    render(<OrderActions orderId="o1" orderStatus="paid" fulfilmentStatus="packed" />);
    expect(screen.getByRole('button', { name: 'Mark shipped' })).toBeInTheDocument();
    expect(screen.getByText('Carrier')).toBeInTheDocument();
    expect(screen.getByText('Tracking number')).toBeInTheDocument();
  });

  it('shows no fulfilment steps for a delivered order', () => {
    render(<OrderActions orderId="o1" orderStatus="paid" fulfilmentStatus="delivered" />);
    expect(screen.getByText(/no further fulfilment steps/iu)).toBeInTheDocument();
  });
});

describe('OrderActions — actions', () => {
  it('advances fulfilment and refreshes on success', async () => {
    const user = userEvent.setup();
    render(<OrderActions orderId="o1" orderStatus="paid" fulfilmentStatus="unfulfilled" />);

    await user.click(screen.getByRole('button', { name: 'Mark packed' }));

    await waitFor(() => {
      expect(advanceFulfilment).toHaveBeenCalledWith('o1', {
        status: 'packed',
        carrier: null,
        trackingNo: null,
        holdReason: null,
      });
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it('requires a cancel reason before the cancel button is enabled', async () => {
    const user = userEvent.setup();
    render(<OrderActions orderId="o1" orderStatus="paid" fulfilmentStatus="unfulfilled" />);

    const cancelButton = screen.getByRole('button', { name: 'Cancel order' });
    expect(cancelButton).toBeDisabled();

    await user.type(
      screen.getByRole('textbox', { name: /shown to the customer/iu }),
      'Customer asked.',
    );
    expect(cancelButton).toBeEnabled();
  });

  it('shows the API error message when an action is rejected', async () => {
    const { ApiError } = await import('@/lib/api');
    advanceFulfilment.mockRejectedValueOnce(
      new ApiError(401, 'UNAUTHENTICATED', 'Sign in as a staff member to make changes.'),
    );
    const user = userEvent.setup();
    render(<OrderActions orderId="o1" orderStatus="paid" fulfilmentStatus="unfulfilled" />);

    await user.click(screen.getByRole('button', { name: 'Mark packed' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in as a staff member');
  });

  it('hides the cancel control for a terminal order', () => {
    render(<OrderActions orderId="o1" orderStatus="refunded" fulfilmentStatus="delivered" />);
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });
});
