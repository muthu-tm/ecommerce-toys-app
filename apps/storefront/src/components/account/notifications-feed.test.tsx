import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationFeed } from '@/lib/use-notifications';

const feed = vi.hoisted(() => ({ current: {} as NotificationFeed }));
const auth = vi.hoisted((): { current: { uid: string | null; ready: boolean } } => ({
  current: { uid: 'cust-1', ready: true },
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth.current }));
vi.mock('@/lib/use-notifications', () => ({ useNotifications: () => feed.current }));

const { NotificationsFeed } = await import('./NotificationsFeed');

beforeEach(() => {
  auth.current = { uid: 'cust-1', ready: true };
  feed.current = { notifications: [], unreadCount: 0, live: true, markRead: vi.fn() };
});

describe('NotificationsFeed', () => {
  it('renders the feed items linking to their targets', () => {
    feed.current = {
      notifications: [
        {
          id: 'n1',
          title: 'Order RMP-1001 placed',
          body: 'Pay within 30 minutes.',
          link: '/account/orders/order-1',
          createdAt: new Date(),
          read: false,
        },
      ],
      unreadCount: 1,
      live: true,
      markRead: vi.fn(),
    };
    render(<NotificationsFeed />);
    const link = screen.getByRole('link', { name: /order rmp-1001 placed/iu });
    expect(link).toHaveAttribute('href', '/account/orders/order-1');
  });

  it('shows the empty state', () => {
    render(<NotificationsFeed />);
    expect(screen.getByText(/nothing new/iu)).toBeInTheDocument();
  });

  it('shows the signed-out prompt', () => {
    auth.current = { uid: null, ready: true };
    render(<NotificationsFeed />);
    expect(screen.getByText(/sign in to see your updates/iu)).toBeInTheDocument();
  });
});
