import { getStorage } from 'firebase-admin/storage';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onObjectFinalized } from 'firebase-functions/v2/storage';

import { StoredEventSchema } from '@romp/contracts';
import type { CountableProduct } from '@romp/core';
import {
  applyProductCountDeltas,
  asSystem,
  COLLECTIONS,
  computeDailyRollup,
  decodeTimestamps,
  sweepExpiredReservations,
} from '@romp/data';
import { createLogger } from '@romp/observability';
import storeConfig from '@romp/store-config/generated/store-config.json';

import { finalizeMediaObject, parseProductMediaPath } from './media/finalize';
import { measureDispatchBacklog } from './notifications/backlog';
import { storeContext } from './notifications/context';
import { dispatchStoredEvent } from './notifications/dispatcher';
import { measureReservationBacklog } from './reservations/backlog';

/**
 * The background Cloud Functions: the notification dispatcher and the backlog alarm.
 *
 * These are separate deployables from the HTTP API (`index.ts`), triggered by Firestore
 * and the scheduler rather than by a request. They are the reason `events` is worth having
 * as a spine: a feature appends a fact, and this turns it into what customers and admins
 * see, without the feature knowing anything about notifications.
 *
 * Region-pinned to `asia-south1` to sit beside Firestore — a cross-region trigger hop on
 * every event is latency the notification a customer is waiting for does not need.
 */

const REGION = 'asia-south1';
const logger = createLogger({ name: 'functions' });

/**
 * Fans an appended event out into notifications.
 *
 * On any `events/{eventId}` create, decode the document, attach its ID, and dispatch. The
 * dispatch is idempotent, so Firestore's at-least-once retry is safe. A decode failure is
 * logged and swallowed rather than retried forever — a malformed event is a bug to fix at
 * the source, not a transient error, and retrying it would only spin.
 */
export const notificationDispatcher = onDocumentCreated(
  { region: REGION, document: `${COLLECTIONS.events}/{eventId}` },
  async (event) => {
    const snapshot = event.data;
    if (snapshot === undefined) return;

    const decoded = decodeTimestamps(snapshot.data());
    const parsed = StoredEventSchema.safeParse({ ...decoded, id: event.params.eventId });
    if (!parsed.success) {
      logger.error(
        { event: 'notification.undispatchable', eventId: event.params.eventId },
        'notification.undispatchable',
      );
      return;
    }

    await dispatchStoredEvent(storeContext(), parsed.data, logger);
  },
);

/**
 * The backlog alarm.
 *
 * Because there is no email fallback, a stalled dispatcher is silent customer harm — so the
 * alert is on **backlog age**, not error rate: a dispatcher that has stopped being invoked
 * throws nothing at all. This runs on a schedule, measures the age of the oldest event whose
 * notifications have not been written, and logs at `error` when it exceeds the threshold —
 * which the alert policy (RUNBOOKS) watches for. Emitting the signal here keeps the
 * threshold in one place and the policy declarative.
 */
export const notificationBacklogAlarm = onSchedule(
  { region: REGION, schedule: 'every 5 minutes' },
  async () => {
    const backlog = await measureDispatchBacklog(storeContext());
    if (
      backlog.oldestUndispatchedAgeMs !== null &&
      backlog.oldestUndispatchedAgeMs > BACKLOG_ALERT_MS
    ) {
      logger.error(
        {
          event: 'notification.backlog',
          oldestUndispatchedAgeMs: backlog.oldestUndispatchedAgeMs,
          undispatchedCount: backlog.undispatchedCount,
        },
        'notification.backlog exceeds threshold',
      );
    } else {
      logger.info(
        { event: 'notification.backlog', undispatchedCount: backlog.undispatchedCount },
        'notification.backlog healthy',
      );
    }
  },
);

/** Alert when the oldest undispatched event is older than five minutes — one schedule cycle. */
const BACKLOG_ALERT_MS = 5 * 60 * 1000;

/**
 * The reservation sweeper.
 *
 * Releases every reservation past its expiry that still holds stock, then measures what remains.
 * The release itself is idempotent and per-reservation transactional (`@romp/data`), so this glue is
 * thin: run the sweep, then read the residual backlog age and alert on it.
 *
 * The alert is on **backlog age, not error rate**, and it is measured here rather than in a separate
 * alarm because the sweeper is the thing that would stall — a reservation still `active` and overdue
 * after a sweep pass means the pass could not free it, and a sweeper that has stopped running
 * entirely simply stops emitting the healthy heartbeat, which a log-absence policy catches. Either
 * way a growing age is the signal, and it lands in one place beside the sweep that owns it
 * (`RUNBOOKS.md` runbook 2, ADR-0007).
 */
export const reservationSweeper = onSchedule(
  { region: REGION, schedule: 'every 5 minutes' },
  async () => {
    const ctx = storeContext();
    const result = await sweepExpiredReservations(ctx);

    const backlog = await measureReservationBacklog(ctx);
    if (
      backlog.oldestOverdueAgeMs !== null &&
      backlog.oldestOverdueAgeMs > SWEEP_BACKLOG_ALERT_MS
    ) {
      logger.error(
        {
          event: 'reservation.backlog',
          oldestOverdueAgeMs: backlog.oldestOverdueAgeMs,
          overdueCount: backlog.overdueCount,
          released: result.released,
          skipped: result.skipped,
        },
        'reservation.backlog exceeds threshold',
      );
    } else {
      logger.info(
        {
          event: 'reservation.sweep',
          found: result.found,
          released: result.released,
          skipped: result.skipped,
        },
        'reservation.sweep healthy',
      );
    }
  },
);

/**
 * Alert when a reservation is still overdue-and-active more than ten minutes past expiry — two
 * schedule cycles, so a single missed run does not page. A healthy sweep clears everything overdue,
 * so a positive reading here is a sweep that could not keep up or one that is not running.
 */
const SWEEP_BACKLOG_ALERT_MS = 10 * 60 * 1000;

/** How many leading bytes to read for a magic-byte sniff — a header, not the whole file. */
const SNIFF_BYTES = 64;

/**
 * Re-derives an uploaded product image's type from its bytes and quarantines mismatches.
 *
 * The storage rules gate the upload on the *declared* type, which is a client claim. This is
 * the authoritative check: on `products/{productId}/{fileName}` finalize, read the object's
 * head, and let `finalizeMediaObject` decide — accept and record dimensions, or quarantine
 * (drop the media entry and delete the object). A path that is not product media is ignored.
 *
 * The decision logic and its side effects are `finalizeMediaObject`, unit-tested with the
 * operations injected; this is the thin glue that binds it to real Cloud Storage.
 */
export const mediaFinalizer = onObjectFinalized({ region: REGION }, async (event) => {
  const objectPath = event.data.name;
  const parsed = parseProductMediaPath(objectPath);
  if (parsed === null) return; // Not product media — a store asset or a payment proof.

  const bucket = getStorage().bucket(event.data.bucket);

  await finalizeMediaObject(
    storeContext(),
    asSystem('media finalize'),
    {
      readObjectHead: async (path) => {
        const [contents] = await bucket.file(path).download({ start: 0, end: SNIFF_BYTES - 1 });
        return new Uint8Array(contents);
      },
      declaredContentType: (path) =>
        bucket
          .file(path)
          .getMetadata()
          .then(([metadata]) => metadata.contentType ?? ''),
      deleteObject: (path) =>
        bucket
          .file(path)
          .delete()
          .then(() => undefined),
      // Dimensions come from the Resize Images extension's output in v1.0; a null here keeps
      // the placeholder rather than parsing every format's header in this glue. The entry is
      // still confirmed as a valid image by the accept decision.
      readDimensions: () => null,
    },
    { productId: parsed.productId, objectPath },
    logger,
  );
});

/** Reduces a stored product document to the two fields that decide the facet count. */
function countableFrom(data: Record<string, unknown> | undefined): CountableProduct | null {
  if (data === undefined) return null;
  const categorySlug = typeof data.categorySlug === 'string' ? data.categorySlug : null;
  return { categorySlug, active: data.status === 'active' };
}

/**
 * Maintains `categories.productCount` as products are written.
 *
 * Firestore cannot count query matches, so the facet numbers the storefront sidebar shows are a
 * denormalised counter — and a counter has to have exactly one writer that keeps it true. This is
 * that writer: on any `products/{id}` create, update or delete, it reduces the before and after
 * state to "which category, and is it active", and applies the resulting per-category deltas up
 * the tree via `FieldValue.increment`. Only `active` products count, so a publish is +1 and an
 * archive is −1; a recategorisation moves the count between chains; an edit that changes neither
 * category nor status writes nothing.
 *
 * The delta arithmetic is pure and unit-tested in `@romp/core`; applying it (reading the tree,
 * incrementing each ancestor in a transaction) is `@romp/data`'s `applyProductCountDeltas`. This
 * is the thin trigger that decodes the snapshot and calls it. Idempotency is the one caveat,
 * stated rather than hidden: `increment` is not idempotent, so a retried invocation can
 * double-count — which is exactly why `reconcileCategoryCount` and its script exist as the
 * correction path (RUNBOOKS).
 */
export const categoryProductCounter = onDocumentWritten(
  { region: REGION, document: `${COLLECTIONS.products}/{productId}` },
  async (event) => {
    const before = countableFrom(event.data?.before.data());
    const after = countableFrom(event.data?.after.data());

    try {
      await applyProductCountDeltas(storeContext(), before, after);
    } catch (error) {
      // A failed count update is a stale sidebar number, not lost data — the ledger of truth is
      // the products themselves, and `reconcileCategoryCount` can rebuild the count. Log so a
      // persistently failing counter is visible rather than retried into a double-count.
      logger.error(
        { event: 'category.count.failed', productId: event.params.productId, error },
        'category.count.failed',
      );
    }
  },
);

/**
 * The store's timezone, from config. It decides which calendar day an order belongs to (`DATA_MODEL`).
 */
const STORE_TIMEZONE = storeConfig.locale.timezone;

/**
 * The `yyyy-mm-dd` of the store-local day `daysAgo` days before an instant.
 *
 * Formatted in the store timezone, not UTC, so a rollup run just after local midnight rolls up the
 * day that just ended rather than one still off by a UTC offset. `en-CA` renders `yyyy-mm-dd`
 * directly, which is exactly the rollup document's key format.
 */
function storeLocalDate(instant: Date, timeZone: string, daysAgo: number): string {
  const shifted = new Date(instant.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

/**
 * The daily analytics rollup.
 *
 * The admin dashboard must never scan `orders` on read (`DATA_MODEL.md`), so once a day this
 * pre-computes the day that just ended into one small `analytics/rollups/daily/{date}` document. It
 * runs a little after local midnight and rolls up **yesterday** — the completed store-local day, not
 * the one in progress, whose figures are still moving. The write is keyed by the date, so a retried
 * or manually re-triggered run overwrites rather than duplicates: the rollup is a materialised view,
 * and recomputing it is always safe. Scheduled in the store timezone so "just after midnight" means
 * the store's midnight.
 */
export const analyticsDailyRollup = onSchedule(
  { region: REGION, schedule: '30 0 * * *', timeZone: STORE_TIMEZONE },
  async () => {
    const ctx = storeContext();
    const date = storeLocalDate(ctx.clock.now(), STORE_TIMEZONE, 1);

    const rollup = await computeDailyRollup(ctx, asSystem('analytics daily rollup'), {
      date,
      timeZone: STORE_TIMEZONE,
    });

    logger.info(
      {
        event: 'analytics.rollup',
        date,
        orderCount: rollup.orderCount,
        paidCount: rollup.paidCount,
        revenueMinor: rollup.revenueMinor,
      },
      'analytics.rollup complete',
    );
  },
);
