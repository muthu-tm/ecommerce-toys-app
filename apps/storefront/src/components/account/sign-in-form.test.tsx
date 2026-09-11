import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sign-in form normalises the identifier through `signInWithIdentifier`, navigates on success,
 * and shows a single non-enumerating message on any failure. `@/lib/firebase-client` is mocked so
 * the browser SDK never loads in jsdom, and `next/navigation` for the redirect.
 */

const signIn = vi.hoisted(() => vi.fn<() => Promise<void>>());
const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase-client', () => ({ signInWithIdentifier: signIn }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { SignInForm } = await import('./SignInForm');

beforeEach(() => {
  signIn.mockReset();
  push.mockReset();
  refresh.mockReset();
});

describe('SignInForm', () => {
  it('signs in and navigates to the account on success', async () => {
    signIn.mockResolvedValue();
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText(/email or mobile/iu), 'asha@example.com');
    await user.type(screen.getByLabelText(/password/iu), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith(
        'asha@example.com',
        'secret-password',
        expect.objectContaining({ storeId: expect.any(String) }),
      );
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/account');
    });
  });

  it('navigates to `next` when supplied', async () => {
    signIn.mockResolvedValue();
    const user = userEvent.setup();
    render(<SignInForm next="/checkout" />);

    await user.type(screen.getByLabelText(/email or mobile/iu), 'asha@example.com');
    await user.type(screen.getByLabelText(/password/iu), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/checkout');
    });
  });

  it('shows a single non-enumerating message on failure', async () => {
    signIn.mockRejectedValue(new Error('auth/wrong-password'));
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText(/email or mobile/iu), 'asha@example.com');
    await user.type(screen.getByLabelText(/password/iu), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/did not match/iu)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('links to registration', () => {
    render(<SignInForm />);
    expect(screen.getByRole('link', { name: /create an account/iu })).toHaveAttribute(
      'href',
      '/account/register',
    );
  });
});
