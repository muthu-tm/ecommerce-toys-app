'use client';

import {
  type Timestamp,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import { firestoreClient } from './firebase-client';

/**
 * The live notification feed for a signed-in customer.
 *
 * A realtime subscription is the whole reason the client SDK exists here: the bell updates
 * the moment the dispatcher writes, with no polling. The hook owns three concerns the
 * `NOTIFICATIONS.md` spec calls out — the query window, the unread count, and the listener
 * lifecycle — and exposes a `markRead` that writes only the one field rules permit.
 *
 * The window is the newest 20; the badge counts unread within it and caps at `9+`. That is
 * deliberate: an unbounded count is an unbounded read, and past the window a number is
 * decoration, not information.
 */

/** How many recent notifications the bell subscribes to. */
const WINDOW = 20;

export interface FeedNotification {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly link: string;
  readonly createdAt: Date | null;
  readonly read: boolean;
}

export interface NotificationFeed {
  readonly notifications: readonly FeedNotification[];
  /** Count of unread within the window, uncapped — the caller formats `9+`. */
  readonly unreadCount: number;
  /** Whether a live subscription is active (a configured SDK and a signed-in uid). */
  readonly live: boolean;
  /** Marks one notification read by writing only `readAt`, the one field rules allow. */
  readonly markRead: (id: string) => void;
}

interface RawNotification {
  readonly title?: unknown;
  readonly body?: unknown;
  readonly link?: unknown;
  readonly createdAt?: unknown;
  readonly readAt?: unknown;
}

/**
 * Subscribes to `notifications` for `uid` and returns the live feed.
 *
 * `uid === null` (signed out, or no client SDK configured) means no subscription: the hook
 * returns an empty, non-live feed and the bell renders its signed-out affordance. When a
 * uid arrives, the effect subscribes; when it changes or the component unmounts, the effect
 * tears the listener down — a listener leaked per navigation is memory growth and quota
 * burn, which the spec explicitly guards against.
 */
export function useNotifications(uid: string | null): NotificationFeed {
  const [notifications, setNotifications] = useState<readonly FeedNotification[]>([]);
  const [live, setLive] = useState(false);
  // A local set of IDs marked read optimistically, so the badge drops the instant the user
  // clicks, before the server write round-trips.
  const [optimisticRead, setOptimisticRead] = useState<ReadonlySet<string>>(new Set());

  const db = firestoreClient();

  useEffect(() => {
    if (uid === null || db === null) {
      setNotifications([]);
      setLive(false);
      return;
    }

    const feedQuery = query(
      collection(db, 'notifications'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(WINDOW),
    );

    let unsubscribe: (() => void) | null = null;

    const subscribe = (): void => {
      if (unsubscribe !== null) return;
      unsubscribe = onSnapshot(feedQuery, (snapshot) => {
        setNotifications(
          snapshot.docs.map((snap) => {
            const data = snap.data() as RawNotification;
            return {
              id: snap.id,
              title: typeof data.title === 'string' ? data.title : '',
              body: typeof data.body === 'string' ? data.body : '',
              link: typeof data.link === 'string' ? data.link : '/account',
              createdAt: toDate(data.createdAt),
              read: data.readAt != null,
            };
          }),
        );
        setLive(true);
      });
    };

    const detach = (): void => {
      if (unsubscribe === null) return;
      unsubscribe();
      unsubscribe = null;
      setLive(false);
    };

    // A backgrounded tab does not need a live listener — the bell is not on screen, and a
    // listener per hidden tab is quota burned for nothing. Detach on hide, resubscribe on
    // show, which also delivers a fresh snapshot the moment the customer returns.
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') detach();
      else subscribe();
    };

    if (document.visibilityState !== 'hidden') subscribe();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      detach();
    };
  }, [uid, db]);

  const markRead = useMemo(
    () =>
      (id: string): void => {
        // Optimistic: reflect it locally immediately.
        setOptimisticRead((current) => new Set(current).add(id));
        if (db === null) return;
        // Then the narrow write — only `readAt`, which is the entire field the security
        // rules permit a customer to change on their own notification.
        void updateDoc(doc(db, 'notifications', id), { readAt: serverTimestamp() }).catch(() => {
          // A failed write reverts the optimistic state so the badge is honest again.
          setOptimisticRead((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        });
      },
    [db],
  );

  const merged = useMemo(
    () =>
      notifications.map((notification) => ({
        ...notification,
        read: notification.read || optimisticRead.has(notification.id),
      })),
    [notifications, optimisticRead],
  );

  const unreadCount = merged.filter((notification) => !notification.read).length;

  return { notifications: merged, unreadCount, live, markRead };
}

/** Coerces a Firestore Timestamp (or a Date) to a Date, or null. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate();
  }
  return null;
}
