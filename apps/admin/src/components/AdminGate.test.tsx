import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OperatorCheck } from '@/lib/api';
import type { AdminAuthState } from '@/lib/auth-context';

// The gate branches purely on the auth context. Mock it, plus the LoginForm's SDK deps so the
// anonymous branch can render the real form without loading Firebase.
const authState = vi.fn<() => AdminAuthState>();
vi.mock('@/lib/auth-context', () => ({ useAuth: () => authState() }));
vi.mock('@/lib/auth', () => ({ signOutOperator: vi.fn(), signInWithIdentifier: vi.fn() }));

import { AdminGate } from './AdminGate';

const base: AdminAuthState = { uid: null, ready: true, operator: null, refresh: vi.fn() };

function withOperator(operator: OperatorCheck | null, ready = true): void {
  authState.mockReturnValue({ ...base, ready, operator });
}

afterEach(() => {
  authState.mockReset();
});

describe('AdminGate', () => {
  it('shows a spinner until auth is ready', () => {
    withOperator(null, false);
    render(
      <AdminGate>
        <p>secret</p>
      </AdminGate>,
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a spinner while the operator claim is being checked', () => {
    withOperator(null, true);
    render(
      <AdminGate>
        <p>secret</p>
      </AdminGate>,
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('renders the login form when anonymous', () => {
    withOperator({ kind: 'anonymous' });
    render(
      <AdminGate>
        <p>secret</p>
      </AdminGate>,
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a clear refusal for a signed-in non-operator, not a blank screen', () => {
    withOperator({ kind: 'forbidden' });
    render(
      <AdminGate>
        <p>secret</p>
      </AdminGate>,
    );
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'This area is for store staff' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('renders the backoffice for an operator', () => {
    withOperator({ kind: 'operator', uid: 'u1', role: 'owner' });
    render(
      <AdminGate>
        <p>secret</p>
      </AdminGate>,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
});
