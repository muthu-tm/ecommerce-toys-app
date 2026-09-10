import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The add-to-cart button. The concern is that it posts one of the selected variant through the cart
 * API and navigates to the bag, that a disabled control never posts, and that a server refusal
 * shows the server's message rather than a generic one.
 */

const add = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const push = vi.hoisted(() => vi.fn());

vi.mock('@/lib/cart-api', () => ({
  cartApi: { add },
  CartApiError: class CartApiError extends Error {
    constructor(_status: number, _code: string, detail: string) {
      super(detail);
    }
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const { AddToCartButton } = await import('./AddToCartButton');

beforeEach(() => {
  add.mockClear();
  push.mockClear();
});

describe('AddToCartButton', () => {
  it('adds one of the selected variant and navigates to the bag', async () => {
    const user = userEvent.setup();
    render(<AddToCartButton productId="p1" variantId="v1" inStock label="Add to bag" />);

    await user.click(screen.getByRole('button', { name: 'Add to bag' }));

    await waitFor(() => {
      expect(add).toHaveBeenCalledWith({ productId: 'p1', variantId: 'v1', qty: 1, mode: 'add' });
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/cart');
    });
  });

  it('renders a disabled button and does not post when out of stock', async () => {
    const user = userEvent.setup();
    render(<AddToCartButton productId="p1" variantId="v1" inStock={false} label="Add to bag" />);

    const button = screen.getByRole('button', { name: 'Add to bag' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(add).not.toHaveBeenCalled();
  });

  it("shows the server's message when the add is refused", async () => {
    const { CartApiError } = await import('@/lib/cart-api');
    add.mockRejectedValueOnce(
      new CartApiError(
        409,
        'INVALID_STATE_TRANSITION',
        'There is not enough stock for that quantity.',
      ),
    );
    const user = userEvent.setup();
    render(<AddToCartButton productId="p1" variantId="v1" inStock label="Add to bag" />);

    await user.click(screen.getByRole('button', { name: 'Add to bag' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/not enough stock/u);
    });
    expect(push).not.toHaveBeenCalled();
  });
});
