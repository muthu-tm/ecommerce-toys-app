import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wishlist heart reads the saved state client-side, toggles through the API optimistically, and
 * shows a sign-in link when signed out. The Firestore getDoc and the account API are mocked.
 */

const add = vi.hoisted(() => vi.fn<() => Promise<void>>());
const remove = vi.hoisted(() => vi.fn<() => Promise<void>>());
const getDoc = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const auth = vi.hoisted((): { current: { uid: string | null; ready: boolean } } => ({
  current: { uid: 'cust-1', ready: true },
}));

vi.mock('@/lib/account-api', () => ({
  accountApi: { addToWishlist: add, removeFromWishlist: remove },
  AccountApiError: class AccountApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.current }));
vi.mock('@/lib/firebase-client', () => ({ firestoreClient: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: (...args: unknown[]) => getDoc(...args),
}));

const { WishlistHeart } = await import('./WishlistHeart');

beforeEach(() => {
  add.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
  getDoc.mockReset();
  auth.current = { uid: 'cust-1', ready: true };
});

describe('WishlistHeart', () => {
  it('saves a product not yet on the list', async () => {
    getDoc.mockResolvedValue({ exists: () => false });
    const user = userEvent.setup();
    render(<WishlistHeart productId="wooden-blocks" />);

    const button = await screen.findByRole('button', { name: /save this toy/iu });
    await user.click(button);

    await waitFor(() => {
      expect(add).toHaveBeenCalledWith('wooden-blocks');
    });
  });

  it('removes a product already saved', async () => {
    getDoc.mockResolvedValue({ exists: () => true });
    const user = userEvent.setup();
    render(<WishlistHeart productId="wooden-blocks" />);

    const button = await screen.findByRole('button', { name: /remove from saved toys/iu });
    await user.click(button);

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('wooden-blocks');
    });
  });

  it('shows a sign-in link when signed out', () => {
    auth.current = { uid: null, ready: true };
    render(<WishlistHeart productId="wooden-blocks" />);
    const link = screen.getByRole('link', { name: /sign in to save/iu });
    expect(link.getAttribute('href')).toContain('/account/sign-in');
    expect(link.getAttribute('href')).toContain('wooden-blocks');
  });
});
