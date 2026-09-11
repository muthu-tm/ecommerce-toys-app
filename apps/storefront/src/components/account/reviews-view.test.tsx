import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OwnReviewListResponse, OwnReviewView } from '@romp/contracts';

const listReviews = vi.hoisted(() => vi.fn<() => Promise<OwnReviewListResponse>>());
const auth = vi.hoisted((): { current: { uid: string | null; ready: boolean } } => ({
  current: { uid: 'cust-1', ready: true },
}));

vi.mock('@/lib/account-api', () => ({
  accountApi: { listReviews },
  AccountApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.current }));

const { ReviewsView } = await import('./ReviewsView');

const aReview = (overrides: Partial<OwnReviewView> = {}): OwnReviewView =>
  ({
    id: 'review-1',
    productId: 'wooden-blocks',
    authorName: 'Asha M.',
    rating: 4,
    title: 'Sturdy',
    body: 'Held up well.',
    verifiedPurchase: true,
    status: 'pending',
    createdAt: new Date(),
    ...overrides,
  }) as OwnReviewView;

beforeEach(() => {
  listReviews.mockReset();
  auth.current = { uid: 'cust-1', ready: true };
});

describe('ReviewsView', () => {
  it('shows a pending review as awaiting approval', async () => {
    listReviews.mockResolvedValue({ reviews: [aReview({ status: 'pending' })] });
    render(<ReviewsView />);
    expect(await screen.findByText('Sturdy')).toBeInTheDocument();
    expect(screen.getByText(/awaiting approval/iu)).toBeInTheDocument();
  });

  it('shows a rejected review as not published, never the reason', async () => {
    listReviews.mockResolvedValue({
      reviews: [aReview({ status: 'rejected', title: 'Rejected one' })],
    });
    render(<ReviewsView />);
    expect(await screen.findByText('Rejected one')).toBeInTheDocument();
    expect(screen.getByText(/not published/iu)).toBeInTheDocument();
  });

  it('shows the empty state with no reviews', async () => {
    listReviews.mockResolvedValue({ reviews: [] });
    render(<ReviewsView />);
    expect(await screen.findByText(/no reviews yet/iu)).toBeInTheDocument();
  });

  it('shows the signed-out prompt', () => {
    auth.current = { uid: null, ready: true };
    render(<ReviewsView />);
    expect(screen.getByText(/sign in to see your reviews/iu)).toBeInTheDocument();
  });
});
