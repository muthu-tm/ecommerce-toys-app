import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CartView } from '@romp/contracts';

/**
 * The cart page body. The concern is that it loads the cart from the API, renders the empty state
 * when there is nothing, and drives remove / quantity / gift-wrap mutations back through the API,
 * re-rendering from the returned view.
 */

const get = vi.hoisted(() => vi.fn<() => Promise<CartView>>());
const remove = vi.hoisted(() => vi.fn<() => Promise<CartView>>());
const add = vi.hoisted(() => vi.fn<() => Promise<CartView>>());
const setGiftWrap = vi.hoisted(() => vi.fn<() => Promise<CartView>>());

vi.mock('@/lib/cart-api', () => ({
  cartApi: { get, remove, add, setGiftWrap },
  CartApiError: class CartApiError extends Error {},
}));

const { CartClient } = await import('./CartClient');

const line = (variantId: string, qty: number) => ({
  variantId,
  productId: 'wooden-blocks',
  sku: variantId,
  qty,
  priceMinorSnapshot: 1_29_900,
  nameSnapshot: 'Wooden blocks',
  variantNameSnapshot: '240 pieces',
  imagePathSnapshot: null,
  lineSubtotalMinor: 1_29_900 * qty,
  inStock: true,
});

const view = (items: ReturnType<typeof line>[]): CartView =>
  ({
    items,
    giftWrap: false,
    itemCount: items.reduce((total, item) => total + item.qty, 0),
    subtotalMinor: items.reduce((total, item) => total + item.lineSubtotalMinor, 0),
  }) as unknown as CartView;

beforeEach(() => {
  get.mockReset();
  remove.mockReset();
  add.mockReset();
  setGiftWrap.mockReset();
});

describe('CartClient', () => {
  it('renders the empty state when the cart has no items', async () => {
    get.mockResolvedValue(view([]));
    render(<CartClient />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
    // The empty-state copy comes from store config; the heading is not "Your bag".
    expect(screen.queryByText('Your bag')).not.toBeInTheDocument();
  });

  it('renders lines with their subtotal and total', async () => {
    get.mockResolvedValue(view([line('v1', 2)]));
    render(<CartClient />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Your bag' })).toBeInTheDocument();
    });
    expect(screen.getByText('Wooden blocks')).toBeInTheDocument();
    // 2 × ₹1,299 = ₹2,598.
    expect(screen.getAllByText(/2,598/u).length).toBeGreaterThan(0);
    // The checkout link appears when there are items.
    expect(screen.getByRole('link', { name: /checkout/iu })).toHaveAttribute('href', '/checkout');
  });

  it('removes a line through the API and re-renders from the returned view', async () => {
    get.mockResolvedValue(view([line('v1', 1)]));
    remove.mockResolvedValue(view([]));
    const user = userEvent.setup();
    render(<CartClient />);
    await waitFor(() => {
      expect(screen.getByText('Wooden blocks')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Remove Wooden blocks/u }));

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('v1');
    });
    // The empty view returned by remove now renders the empty state.
    await waitFor(() => {
      expect(screen.queryByText('Wooden blocks')).not.toBeInTheDocument();
    });
  });

  it('toggles gift wrap through the API', async () => {
    get.mockResolvedValue(view([line('v1', 1)]));
    setGiftWrap.mockResolvedValue({ ...view([line('v1', 1)]), giftWrap: true });
    const user = userEvent.setup();
    render(<CartClient />);
    await waitFor(() => {
      expect(screen.getByText('Wooden blocks')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('checkbox', { name: /Gift wrap/u }));

    await waitFor(() => {
      expect(setGiftWrap).toHaveBeenCalledWith(true);
    });
  });

  it('sets a line quantity through the API', async () => {
    get.mockResolvedValue(view([line('v1', 1)]));
    add.mockResolvedValue(view([line('v1', 3)]));
    const user = userEvent.setup();
    render(<CartClient />);
    await waitFor(() => {
      expect(screen.getByText('Wooden blocks')).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Quantity of Wooden blocks/u }),
      '3',
    );

    await waitFor(() => {
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ variantId: 'v1', qty: 3, mode: 'set' }),
      );
    });
  });
});
