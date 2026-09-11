import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const removeFromWishlist = vi.hoisted(() => vi.fn<() => Promise<void>>());
const getDocs = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const auth = vi.hoisted((): { current: { uid: string | null; ready: boolean } } => ({
  current: { uid: 'cust-1', ready: true },
}));

vi.mock('@/lib/account-api', () => ({
  accountApi: { removeFromWishlist },
  AccountApiError: class AccountApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.current }));
vi.mock('@/lib/firebase-client', () => ({ firestoreClient: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  orderBy: () => ({}),
  getDocs: (...args: unknown[]) => getDocs(...args),
}));

const { WishlistView } = await import('./WishlistView');

beforeEach(() => {
  removeFromWishlist.mockReset().mockResolvedValue(undefined);
  getDocs.mockReset();
  auth.current = { uid: 'cust-1', ready: true };
});

describe('WishlistView', () => {
  it('lists saved products and removes one through the API', async () => {
    getDocs.mockResolvedValue({ docs: [{ id: 'wooden-blocks' }] });
    const user = userEvent.setup();
    render(<WishlistView />);

    expect(await screen.findByRole('link', { name: 'wooden-blocks' })).toHaveAttribute(
      'href',
      '/p/wooden-blocks',
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(removeFromWishlist).toHaveBeenCalledWith('wooden-blocks');
    });
  });

  it('shows the empty state when nothing is saved', async () => {
    getDocs.mockResolvedValue({ docs: [] });
    render(<WishlistView />);
    expect(await screen.findByText(/no saved toys yet/iu)).toBeInTheDocument();
  });

  it('shows the signed-out prompt', () => {
    auth.current = { uid: null, ready: true };
    render(<WishlistView />);
    expect(screen.getByText(/sign in to see your saved toys/iu)).toBeInTheDocument();
  });
});
