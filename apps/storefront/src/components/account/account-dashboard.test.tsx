import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeResponse } from '@romp/contracts';

const me = vi.hoisted(() => vi.fn<() => Promise<MeResponse>>());
const updateProfile = vi.hoisted(() => vi.fn<() => Promise<MeResponse>>());
const changePassword = vi.hoisted(() => vi.fn<() => Promise<void>>());
const signOutCustomer = vi.hoisted(() => vi.fn<() => Promise<void>>());
const push = vi.hoisted(() => vi.fn());
const auth = vi.hoisted((): { current: { uid: string | null; ready: boolean } } => ({
  current: { uid: 'cust-1', ready: true },
}));

vi.mock('@/lib/account-api', () => ({
  accountApi: { me, updateProfile, changePassword },
  AccountApiError: class AccountApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.current }));
vi.mock('@/lib/firebase-client', () => ({ signOutCustomer }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const { AccountDashboard } = await import('./AccountDashboard');

const profile: MeResponse = {
  uid: 'cust-1',
  displayName: 'Asha',
  primaryIdentifierType: 'email',
  emailPresent: true,
  phonePresent: false,
  orderCount: 0,
};

beforeEach(() => {
  me.mockReset().mockResolvedValue(profile);
  updateProfile.mockReset().mockResolvedValue(profile);
  changePassword.mockReset().mockResolvedValue(undefined);
  signOutCustomer.mockReset().mockResolvedValue(undefined);
  push.mockReset();
  auth.current = { uid: 'cust-1', ready: true };
});

describe('AccountDashboard', () => {
  it('loads the profile and pre-fills the name', async () => {
    render(<AccountDashboard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/your name/iu)).toHaveValue('Asha');
    });
  });

  it('changes the password and confirms other sessions were signed out', async () => {
    const user = userEvent.setup();
    render(<AccountDashboard />);

    await user.type(screen.getByLabelText(/current password/iu), 'old-password-1');
    await user.type(screen.getByLabelText(/new password/iu), 'copper lantern drift meadow');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalled();
    });
    expect(await screen.findByText(/other sessions were signed out/iu)).toBeInTheDocument();
  });

  it('signs out and navigates home', async () => {
    const user = userEvent.setup();
    render(<AccountDashboard />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(signOutCustomer).toHaveBeenCalled();
    });
  });

  it('shows the signed-out prompt', () => {
    auth.current = { uid: null, ready: true };
    render(<AccountDashboard />);
    expect(screen.getByText(/sign in to see your account/iu)).toBeInTheDocument();
  });
});
