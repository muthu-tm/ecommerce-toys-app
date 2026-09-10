import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CartView } from '@romp/contracts';

/**
 * The header bag badge. It shows the item count on load and renders nothing when the bag is empty
 * or the fetch fails — a missing badge beats a broken header.
 */

const get = vi.hoisted(() => vi.fn<() => Promise<CartView>>());

vi.mock('@/lib/cart-api', () => ({
  cartApi: { get },
  CartApiError: class CartApiError extends Error {},
}));

const { CartBadge } = await import('./CartBadge');

const view = (itemCount: number): CartView => ({
  items: [],
  giftWrap: false,
  itemCount,
  subtotalMinor: 0 as CartView['subtotalMinor'],
});

beforeEach(() => {
  get.mockReset();
});

describe('CartBadge', () => {
  it('shows the item count once loaded', async () => {
    get.mockResolvedValue(view(3));
    render(<CartBadge />);
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('renders nothing for an empty bag', async () => {
    get.mockResolvedValue(view(0));
    const { container } = render(<CartBadge />);
    await waitFor(() => {
      expect(get).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the fetch fails', async () => {
    get.mockRejectedValue(new Error('network'));
    const { container } = render(<CartBadge />);
    await waitFor(() => {
      expect(get).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });
});
