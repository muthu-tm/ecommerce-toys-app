import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewSubmitResponse } from '@romp/contracts';

import { content } from '@/lib/store';

const submitReview = vi.hoisted(() => vi.fn<() => Promise<ReviewSubmitResponse>>());
const auth = vi.hoisted((): { current: { uid: string | null; ready: boolean } } => ({
  current: { uid: 'cust-1', ready: true },
}));

vi.mock('@/lib/account-api', () => ({
  accountApi: { submitReview },
  AccountApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.current }));

const { ReviewForm } = await import('./ReviewForm');

const copy = content.product.reviews;

beforeEach(() => {
  submitReview.mockReset();
  auth.current = { uid: 'cust-1', ready: true };
});

describe('ReviewForm', () => {
  it('prompts a signed-out visitor to sign in instead of showing the form', () => {
    auth.current = { uid: null, ready: true };
    render(<ReviewForm productId="wooden-blocks" />);
    expect(screen.getByText(copy.signInPrompt)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.submitLabel })).not.toBeInTheDocument();
  });

  it('renders nothing until auth resolves', () => {
    auth.current = { uid: null, ready: false };
    const { container } = render(<ReviewForm productId="wooden-blocks" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('submits a review and shows the pending notice', async () => {
    submitReview.mockResolvedValue({} as ReviewSubmitResponse);
    render(<ReviewForm productId="wooden-blocks" />);

    await userEvent.type(screen.getByLabelText(new RegExp(copy.titleLabel, 'iu')), 'Great toy');
    await userEvent.type(
      screen.getByLabelText(new RegExp(copy.bodyLabel, 'iu')),
      'Really well made.',
    );
    await userEvent.click(screen.getByRole('button', { name: copy.submitLabel }));

    expect(await screen.findByText(copy.pendingNotice)).toBeInTheDocument();
    expect(submitReview).toHaveBeenCalledOnce();
  });

  it('surfaces a submission error', async () => {
    submitReview.mockRejectedValue(new Error('boom'));
    render(<ReviewForm productId="wooden-blocks" />);

    await userEvent.type(screen.getByLabelText(new RegExp(copy.titleLabel, 'iu')), 'Great toy');
    await userEvent.type(
      screen.getByLabelText(new RegExp(copy.bodyLabel, 'iu')),
      'Really well made.',
    );
    await userEvent.click(screen.getByRole('button', { name: copy.submitLabel }));

    expect(await screen.findByText(/could not post your review/iu)).toBeInTheDocument();
  });
});
