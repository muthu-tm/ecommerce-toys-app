import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The moderation controls publish a review, or reveal a reason field and reject with it. `@/lib/api`
 * is mocked so the browser Firebase SDK it transitively imports never loads in jsdom, and
 * `next/navigation` is mocked for the refresh after an action.
 */

const publishReview = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const rejectReview = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const refresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  adminApi: { publishReview, rejectReview },
  ApiError: class ApiError extends Error {
    code: string;
    constructor(_status: number, code: string, detail: string) {
      super(detail);
      this.code = code;
    }
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { ReviewModerationActions } = await import('./ReviewModerationActions');

beforeEach(() => {
  publishReview.mockClear();
  rejectReview.mockClear();
  refresh.mockClear();
});

describe('ReviewModerationActions', () => {
  it('publishes a review and refreshes', async () => {
    render(<ReviewModerationActions reviewId="r1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(publishReview).toHaveBeenCalledWith('r1');
  });

  it('reveals the reason field only when rejecting, and requires a reason', async () => {
    render(<ReviewModerationActions reviewId="r1" />);
    // No reason field until Reject is opened.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const confirm = screen.getByRole('button', { name: 'Confirm rejection' });
    // Empty reason keeps the confirm disabled.
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox'), 'Off-topic');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(rejectReview).toHaveBeenCalledWith('r1', { reason: 'Off-topic' });
  });
});
