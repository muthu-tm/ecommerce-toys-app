import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Firebase sign-in is browser-SDK glue — mock it. The auth context's refresh is what flips the
// gate on success, so it is mocked and asserted.
const signIn = vi.fn<(id: string, pw: string, opts: unknown) => Promise<void>>();
const refresh = vi.fn();
vi.mock('@/lib/auth', () => ({ signInWithIdentifier: (...args: [string, string, unknown]) => signIn(...args) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ refresh }) }));

import { LoginForm } from './LoginForm';

afterEach(() => {
  signIn.mockReset();
  refresh.mockReset();
});

describe('LoginForm', () => {
  it('signs in with the entered identifier and refreshes the claim check', async () => {
    signIn.mockResolvedValue();
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/Email or mobile number/u), 'owner@example.test');
    await user.type(screen.getByLabelText(/Password/u), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith(
        'owner@example.test',
        'correct horse battery',
        expect.objectContaining({ storeId: expect.any(String) }),
      );
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('shows one non-enumerating message on failure', async () => {
    signIn.mockRejectedValue(new Error('auth/wrong-password'));
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/Email or mobile number/u), 'owner@example.test');
    await user.type(screen.getByLabelText(/Password/u), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // The message must not reveal whether the account exists — it is one line for every failure.
    expect(await screen.findByText(/did not match/u)).toBeInTheDocument();
    expect(screen.queryByText(/wrong-password/u)).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
