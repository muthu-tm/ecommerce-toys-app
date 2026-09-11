import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReviewDoc } from '@romp/contracts';
import { aReview } from '@romp/contracts/fixtures';
import type { WithId } from '@romp/data';

/**
 * The moderation queue lists pending reviews with their full context and escapes the body. The
 * per-row actions transitively import `@/lib/api` (the browser Firebase SDK), mocked here, and
 * `next/navigation`.
 */

vi.mock('@/lib/api', () => ({
  adminApi: { publishReview: vi.fn(), rejectReview: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { ReviewQueue } = await import('./ReviewQueue');

const aQueued = (overrides: Partial<ReviewDoc> = {}): WithId<ReviewDoc> => ({
  ...aReview({ status: 'pending', moderatedBy: null, moderatedAt: null, rejectionReason: null }),
  id: 'r1',
  ...overrides,
});

describe('ReviewQueue', () => {
  it('shows the empty state when nothing is pending', () => {
    render(<ReviewQueue reviews={[]} />);
    expect(screen.getByText(/queue is clear/iu)).toBeInTheDocument();
  });

  it('renders a queued review with its author and verified badge', () => {
    render(<ReviewQueue reviews={[aQueued({ verifiedPurchase: true })]} />);
    expect(screen.getByRole('heading', { name: /Sturdy/u })).toBeInTheDocument();
    expect(screen.getByText(/Verified purchase/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  it('escapes the review body rather than interpreting markup', () => {
    const nasty = '<script>alert(1)</script> & <b>bold</b>';
    const { container } = render(<ReviewQueue reviews={[aQueued({ body: nasty })]} />);
    expect(screen.getByText(nasty)).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});
