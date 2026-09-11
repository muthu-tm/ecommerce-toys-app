import type { FeedNotification } from './use-notifications';

/**
 * Groups notifications into Today / Yesterday / Earlier for the bell.
 *
 * Pure and separately testable — the grouping is date arithmetic that a component test
 * should not have to fake a clock to exercise, and getting "yesterday" wrong at a month
 * boundary is exactly the kind of bug that hides until the first of the month.
 *
 * The bucket labels are passed in, not hardcoded, so the copy stays config-driven like the
 * rest of the storefront.
 */
export type NotificationBucket = 'today' | 'yesterday' | 'earlier';

export interface NotificationGroup {
  readonly bucket: NotificationBucket;
  readonly label: string;
  readonly items: readonly FeedNotification[];
}

export interface BucketLabels {
  readonly today: string;
  readonly yesterday: string;
  readonly earlier: string;
}

/**
 * Buckets by calendar day relative to `now`, preserving input order within each bucket.
 *
 * "Today" and "yesterday" are calendar days in local time, not 24-hour windows — a
 * notification from 11pm yesterday is "yesterday", not "today minus one hour". Empty
 * buckets are omitted, so the bell never renders an empty "Yesterday" heading.
 */
export function groupByDay(
  notifications: readonly FeedNotification[],
  labels: BucketLabels,
  now: Date = new Date(),
): readonly NotificationGroup[] {
  const startOfToday = startOfDay(now).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const buckets: Record<NotificationBucket, FeedNotification[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const notification of notifications) {
    const at = notification.createdAt;
    // A notification with no timestamp (the brief window before the server stamp resolves)
    // sorts into "today" — it just arrived.
    const time = at === null ? startOfToday : startOfDay(at).getTime();
    if (time >= startOfToday) buckets.today.push(notification);
    else if (time >= startOfYesterday) buckets.yesterday.push(notification);
    else buckets.earlier.push(notification);
  }

  const order: readonly NotificationBucket[] = ['today', 'yesterday', 'earlier'];
  return order
    .filter((bucket) => buckets[bucket].length > 0)
    .map((bucket) => ({ bucket, label: labels[bucket], items: buckets[bucket] }));
}

/** Formats the unread badge count, capping at `9+`. */
export function formatBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
