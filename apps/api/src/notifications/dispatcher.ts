import type { StoredEvent } from '@romp/contracts';
import { planNotifications } from '@romp/core';
import type { NotificationContent } from '@romp/core';
import type { StoreContext } from '@romp/data';
import { writeNotification } from '@romp/data';
import type { AppLogger } from '@romp/observability';
import storeConfig from '@romp/store-config/generated/store-config.json';

/**
 * The notification dispatcher's testable core.
 *
 * The Cloud Functions trigger does almost nothing itself: it decodes the `events` write and
 * calls this. Everything that decides *what* to write — the routing, the copy, the
 * deterministic IDs — is `planNotifications` in `@romp/core`, which is pure. This function
 * is the thin I/O shell: plan, then write each notification with an idempotent `set`.
 *
 * Idempotence is the whole point. Firestore retries a trigger, and a dispatcher outage is
 * fixed by replaying the event range — both write the same deterministic IDs, so the second
 * pass overwrites rather than duplicates. That is why a customer hears exactly once even
 * though the trigger may fire more than once.
 */

/** How long a notification lives before the TTL policy trims the feed. */
const NOTIFICATION_TTL_DAYS = 60;

/**
 * The copy templates and money formatting, from the generated store config.
 *
 * Read once at module load — the config is a build-time constant for a given store, so
 * every dispatch shares one bundle rather than rebuilding it per event.
 */
const notificationContent: NotificationContent = {
  templates: storeConfig.content.notifications,
  moneyFormat: { locale: storeConfig.locale.locale, currency: storeConfig.locale.currency },
};

/**
 * Dispatches one stored event: plans its notifications and writes them idempotently.
 *
 * Returns the count written, for the trigger to log. An event routed to neither audience
 * (a rejected review) writes nothing and returns zero — a normal outcome, not a failure.
 */
export async function dispatchStoredEvent(
  ctx: StoreContext,
  event: StoredEvent,
  logger: AppLogger,
): Promise<number> {
  const planned = planNotifications({
    event,
    adminUids: [],
    content: notificationContent,
    ttlDays: NOTIFICATION_TTL_DAYS,
  });

  await Promise.all(planned.map(({ id, doc }) => writeNotification(ctx, id, doc)));

  logger.info(
    {
      event: 'notification.dispatched',
      eventId: event.id,
      eventType: event.type,
      count: planned.length,
    },
    'notification.dispatched',
  );
  return planned.length;
}
