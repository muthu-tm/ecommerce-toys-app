import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The status controls offer only the transitions the state machine permits and surface the
 * API's own error message. `@/lib/api` is mocked so the browser Firebase SDK it transitively
 * imports never loads in jsdom, and `next/navigation` is mocked for the router refresh.
 */

const setStatus = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  adminApi: { setStatus },
  ApiError: class ApiError extends Error {
    code: string;
    constructor(_status: number, code: string, detail: string) {
      super(detail);
      this.code = code;
    }
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const { ProductStatusControls } = await import('./ProductStatusControls');

beforeEach(() => {
  setStatus.mockClear();
  refresh.mockClear();
});

describe('ProductStatusControls', () => {
  it('offers publish and archive for a draft', () => {
    render(<ProductStatusControls productId="p1" status="draft" />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('offers only restore-to-draft for an archived product', () => {
    render(<ProductStatusControls productId="p1" status="archived" />);
    expect(screen.getByRole('button', { name: 'Restore to draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });

  it('calls the API and refreshes on a status change', async () => {
    const user = userEvent.setup();
    render(<ProductStatusControls productId="p1" status="draft" />);

    await user.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith('p1', 'active');
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it('shows the API error message when the change is rejected', async () => {
    const { ApiError } = await import('@/lib/api');
    setStatus.mockRejectedValueOnce(
      new ApiError(409, 'INVALID_STATE_TRANSITION', 'Needs an active variant.'),
    );
    const user = userEvent.setup();
    render(<ProductStatusControls productId="p1" status="draft" />);

    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Needs an active variant.');
  });
});
