import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OperatorCheck } from '@/lib/api';
import { brand, locale } from '@/lib/store';

const authState = vi.fn<() => { operator: OperatorCheck | null }>();
vi.mock('@/lib/auth-context', () => ({ useAuth: () => authState() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/lib/auth', () => ({ signOutOperator: vi.fn() }));

import { AdminShell } from './AdminShell';

const OPERATOR: OperatorCheck = { kind: 'operator', uid: 'u1', role: 'owner' };

afterEach(() => {
  authState.mockReset();
});

describe('AdminShell', () => {
  it('always shows the configured store name, signed in or out', () => {
    authState.mockReturnValue({ operator: { kind: 'anonymous' } });
    render(
      <AdminShell>
        <p>body</p>
      </AdminShell>,
    );
    expect(screen.getByText(`${brand.name} Admin`)).toBeInTheDocument();
  });

  it('hides the section nav and sign-out when not an operator', () => {
    authState.mockReturnValue({ operator: { kind: 'anonymous' } });
    render(
      <AdminShell>
        <p>body</p>
      </AdminShell>,
    );
    expect(screen.queryByRole('navigation', { name: 'Backoffice sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('shows the sidebar sections and sign-out for an operator', () => {
    authState.mockReturnValue({ operator: OPERATOR });
    render(
      <AdminShell>
        <p>body</p>
      </AdminShell>,
    );

    const nav = screen.getByRole('navigation', { name: 'Backoffice sections' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/orders');
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute('href', '/categories');
    expect(screen.getByRole('link', { name: 'Reviews' })).toHaveAttribute('href', '/reviews');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    // Desktop rail and mobile bar both render the mark; the region line is config, not copy.
    expect(screen.getAllByText(`${locale.defaultPhoneRegion} store`).length).toBeGreaterThan(0);
  });

  it('marks Products as the current page on the catalogue home', () => {
    authState.mockReturnValue({ operator: OPERATOR });
    render(
      <AdminShell>
        <p>body</p>
      </AdminShell>,
    );

    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('opens the section list from the mobile menu', async () => {
    authState.mockReturnValue({ operator: OPERATOR });
    render(
      <AdminShell>
        <p>body</p>
      </AdminShell>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('dialog', { name: 'Backoffice' })).toBeInTheDocument();
  });
});
