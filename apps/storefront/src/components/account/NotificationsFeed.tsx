'use client';

import Link from 'next/link';

import { Card } from '@romp/ui';

import { useAuth } from '@/lib/auth-context';
import { content } from '@/lib/store';
import { useNotifications } from '@/lib/use-notifications';

import { SignedOut } from './SignedOut';

/**
 * The full notification feed page.
 *
 * The navbar bell shows the newest few; this is the whole window, using the same live subscription
 * (`useNotifications`). Opening one marks it read — the one field the rules let a customer change.
 * The empty state and copy are the store's own.
 */
export function NotificationsFeed() {
  const { uid, ready } = useAuth();
  const { notifications, markRead } = useNotifications(uid);

  if (!ready) return <p className="font-body text-text-muted">Loading…</p>;
  if (uid === null)
    return <SignedOut next="/account/notifications" message="Sign in to see your updates." />;

  const empty = content.emptyStates.emptyNotifications;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="notifications-heading">
      <h1 id="notifications-heading" className="font-display text-2xl text-text-primary">
        Notifications
      </h1>

      {notifications.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-display text-base text-text-primary">{empty.title}</p>
          <p className="mt-1 font-body text-sm text-text-muted">{empty.body}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <Link
                href={notification.link}
                onClick={() => {
                  markRead(notification.id);
                }}
                className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-4 py-3 hover:border-border-strong"
              >
                <span className="flex items-center gap-2">
                  {!notification.read ? (
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
                  ) : null}
                  <span className="font-body font-semibold text-text-primary">
                    {notification.title}
                  </span>
                </span>
                <span className="font-body text-sm text-text-muted">{notification.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
