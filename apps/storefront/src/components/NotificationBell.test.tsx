import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { content } from '@/lib/store';
import type { FeedNotification, NotificationFeed } from '@/lib/use-notifications';

const markRead = vi.fn();
let feed: NotificationFeed;

vi.mock('@/lib/use-notifications', () => ({
  useNotifications: (): NotificationFeed => feed,
}));

const { NotificationBell } = await import('./NotificationBell');

function note(overrides: Partial<FeedNotification> = {}): FeedNotification {
  return {
    id: 'note-1',
    title: 'Order placed',
    body: 'Pay to confirm.',
    link: '/account/orders/ORD-1',
    createdAt: new Date(),
    read: false,
    ...overrides,
  };
}

function setFeed(notifications: FeedNotification[]): void {
  const unread = notifications.filter((n) => !n.read).length;
  feed = { notifications, unreadCount: unread, live: true, markRead };
}

afterEach(() => {
  markRead.mockReset();
});

describe('NotificationBell', () => {
  it('renders a signed-out link when there is no uid', () => {
    setFeed([]);
    render(<NotificationBell uid={null} />);
    // A link to the account area, not a menu button.
    const link = screen.getByRole('link', { name: 'Notifications' });
    expect(link).toHaveAttribute('href', '/account');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows an unread badge count for a signed-in customer', () => {
    setFeed([note(), note({ id: 'note-2' })]);
    render(<NotificationBell uid="cust-1" />);
    // The accessible name carries the unread count.
    expect(screen.getByRole('button', { name: /2 unread/u })).toBeInTheDocument();
  });

  it('opens the feed and shows notifications grouped', async () => {
    const user = userEvent.setup();
    setFeed([note()]);
    render(<NotificationBell uid="cust-1" />);

    await user.click(screen.getByRole('button'));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Order placed')).toBeInTheDocument();
  });

  it('marks a notification read when its item is clicked', async () => {
    const user = userEvent.setup();
    setFeed([note()]);
    render(<NotificationBell uid="cust-1" />);

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /Order placed/u }));
    expect(markRead).toHaveBeenCalledWith('note-1');
  });

  it('shows the configured empty state when there are no notifications', async () => {
    const user = userEvent.setup();
    setFeed([]);
    render(<NotificationBell uid="cust-1" />);

    await user.click(screen.getByRole('button'));
    expect(screen.getByText(content.emptyStates.emptyNotifications.title)).toBeInTheDocument();
  });
});
