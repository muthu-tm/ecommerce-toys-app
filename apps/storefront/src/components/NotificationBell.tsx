'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Badge, IconButton } from '@romp/ui';

import { formatBadge, groupByDay } from '@/lib/notifications-view';
import { content } from '@/lib/store';
import { useNotifications } from '@/lib/use-notifications';

/**
 * The navbar notification bell.
 *
 * A client island: it holds the realtime subscription, the open/closed state and the
 * mark-read interaction. The subscription only activates for a signed-in customer — `uid`
 * comes from the auth context (Task 20); until then the bell renders as a plain link to the
 * account area, which is the honest signed-out affordance rather than an empty dropdown.
 *
 * Everything customer-facing is config-driven: the empty-state copy and the day-group
 * labels come from store config, so a second store's bell reads in its own voice.
 */
export interface NotificationBellProps {
  /** The signed-in customer's uid, or null when signed out. */
  readonly uid: string | null;
}

const DAY_LABELS = {
  // UI affordance strings, like the search labels in the header — not brand voice, so they
  // are constants here rather than store config. They move to `content` if a store needs to
  // translate them (WHITE_LABEL.md on adding a value).
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
} as const;

export function NotificationBell({ uid }: NotificationBellProps) {
  const { notifications, unreadCount, markRead } = useNotifications(uid);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on an outside click or Escape — a panel that only closes by its own
  // button is one a keyboard or touch user gets stuck in.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent): void => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const badge = formatBadge(unreadCount);
  const groups = groupByDay(notifications, DAY_LABELS);
  const empty = content.emptyStates.emptyNotifications;

  // Signed out: a plain link, no subscription, no dropdown.
  if (uid === null) {
    return (
      <Link
        href="/account"
        aria-label="Notifications"
        className="inline-flex size-11 items-center justify-center rounded-md text-text-primary hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <BellIcon />
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        label={badge === null ? 'Notifications' : `Notifications, ${String(unreadCount)} unread`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span className="relative inline-flex">
          <BellIcon />
          {badge !== null && (
            <span className="absolute -top-2 -right-2">
              <Badge tone="accent">{badge}</Badge>
            </span>
          )}
        </span>
      </IconButton>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-lg"
        >
          {groups.length === 0 ? (
            <div className="p-4 text-center">
              <p className="font-display text-base text-text-primary">{empty.title}</p>
              <p className="mt-1 font-body text-sm text-text-muted">{empty.body}</p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.bucket}>
                <p className="px-2 pt-2 pb-1 font-body text-xs font-semibold tracking-wide text-text-muted uppercase">
                  {group.label}
                </p>
                <ul>
                  {group.items.map((notification) => (
                    <li key={notification.id}>
                      <Link
                        href={notification.link}
                        role="menuitem"
                        onClick={() => {
                          markRead(notification.id);
                          setOpen(false);
                        }}
                        className="flex flex-col gap-0.5 rounded-md px-2 py-2 hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      >
                        <span className="flex items-center gap-2">
                          {!notification.read && (
                            <span
                              aria-hidden="true"
                              className="size-2 shrink-0 rounded-full bg-accent"
                            />
                          )}
                          <span className="font-body text-sm font-semibold text-text-primary">
                            {notification.title}
                          </span>
                        </span>
                        <span className="font-body text-xs text-text-muted">
                          {notification.body}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="none">
      <path d="M6 8a4 4 0 118 0c0 3 1 4 1 4H5s1-1 1-4z" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 15a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
