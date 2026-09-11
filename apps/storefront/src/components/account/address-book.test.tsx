import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The address book lists addresses (client-read), creates through the API, and surfaces the server's
 * refusal to delete the default. Firestore reads and the account API are mocked.
 */

const createAddress = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const deleteAddress = vi.hoisted(() => vi.fn<() => Promise<void>>());
const updateAddress = vi.hoisted(() => vi.fn<() => Promise<void>>());
const getDocs = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const auth = vi.hoisted((): { current: { uid: string | null; ready: boolean } } => ({
  current: { uid: 'cust-1', ready: true },
}));

vi.mock('@/lib/account-api', () => ({
  accountApi: { createAddress, deleteAddress, updateAddress },
  AccountApiError: class AccountApiError extends Error {
    constructor(_status: number, _code: string, detail: string) {
      super(detail);
    }
  },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.current }));
vi.mock('@/lib/firebase-client', () => ({ firestoreClient: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  orderBy: () => ({}),
  getDocs: (...args: unknown[]) => getDocs(...args),
}));

const { AddressBook } = await import('./AddressBook');

const snapshot = (rows: { id: string; isDefault: boolean; label: string }[]) => ({
  docs: rows.map((row) => ({
    id: row.id,
    data: () => ({
      label: row.label,
      recipientName: 'Asha',
      line1: '1 MG Road',
      city: 'Bengaluru',
      pincode: '560001',
      isDefault: row.isDefault,
    }),
  })),
});

beforeEach(() => {
  createAddress.mockReset().mockResolvedValue({ id: 'new' });
  deleteAddress.mockReset().mockResolvedValue(undefined);
  updateAddress.mockReset().mockResolvedValue(undefined);
  getDocs.mockReset();
  auth.current = { uid: 'cust-1', ready: true };
});

describe('AddressBook', () => {
  it('lists addresses and marks the default', async () => {
    getDocs.mockResolvedValue(snapshot([{ id: 'a1', isDefault: true, label: 'Home' }]));
    render(<AddressBook />);
    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('creates an address through the API', async () => {
    getDocs.mockResolvedValue(snapshot([]));
    const user = userEvent.setup();
    render(<AddressBook />);

    await user.type(await screen.findByLabelText(/^Label/u), 'Office');
    await user.type(screen.getByLabelText(/Recipient name/u), 'Asha');
    await user.type(screen.getByLabelText(/Address line 1/u), '9 MG Road');
    await user.type(screen.getByLabelText(/^City/u), 'Bengaluru');
    await user.type(screen.getByLabelText(/^State/u), 'Karnataka');
    await user.type(screen.getByLabelText(/PIN code/u), '560001');
    await user.type(screen.getByLabelText(/Contact number/u), '+919845021174');
    await user.click(screen.getByRole('button', { name: 'Save address' }));

    await waitFor(() => {
      expect(createAddress).toHaveBeenCalled();
    });
  });

  it('surfaces the server refusal to delete the default', async () => {
    const { AccountApiError } = await import('@/lib/account-api');
    getDocs.mockResolvedValue(snapshot([{ id: 'a1', isDefault: true, label: 'Home' }]));
    deleteAddress.mockRejectedValue(
      new AccountApiError(400, 'VALIDATION_FAILED', 'Set a different default first.'),
    );
    const user = userEvent.setup();
    render(<AddressBook />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/set a different default first/iu)).toBeInTheDocument();
  });

  it('shows the signed-out prompt', () => {
    auth.current = { uid: null, ready: true };
    render(<AddressBook />);
    expect(screen.getByText(/sign in to manage your addresses/iu)).toBeInTheDocument();
  });
});
