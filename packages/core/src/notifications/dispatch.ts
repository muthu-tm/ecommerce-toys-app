import type { EventPayload, NotificationDoc, NotificationType, StoredEvent } from '@romp/contracts';
import { formatMoney, notificationId } from '@romp/contracts';

import { NOTIFICATION_ROUTES } from './routing';

/**
 * Turns one stored event into the notifications it produces — the pure heart of the
 * dispatcher.
 *
 * This is where "notifications are derived, never authored" lives. The Cloud Function that
 * runs on an `events` write does almost nothing itself: it decodes the event, calls this,
 * and writes what comes back. Keeping the derivation pure means it is exhaustively testable
 * without Firestore, and — because the document IDs are deterministic — replaying an event
 * range after a dispatcher outage overwrites rather than duplicates.
 *
 * The copy is never a literal here. Titles and bodies come from `content.notifications`
 * templates, interpolated with values drawn from the event payload, so a rebrand restyles
 * every notification and a second store speaks in its own voice.
 */

/** The copy templates and formatting a store supplies, from `content.notifications` + locale. */
export interface NotificationContent {
  /** One template per notification type: `{ title, body }` with `{token}` placeholders. */
  readonly templates: Readonly<
    Record<NotificationType, { readonly title: string; readonly body: string }>
  >;
  /** Locale + currency, for formatting a money amount into a template. */
  readonly moneyFormat: { readonly locale: string; readonly currency: string };
}

export interface DispatchInputs {
  readonly event: StoredEvent;
  /** The seeded admin uids, for the per-admin read map on the shared admin notification. */
  readonly adminUids: readonly string[];
  readonly content: NotificationContent;
  /** How long a notification lives before the TTL policy trims it. */
  readonly ttlDays: number;
}

/**
 * Plans the notifications for one event.
 *
 * Returns a document per recipient with its deterministic ID, ready to `set` idempotently.
 * An event routed to neither audience (a rejected review) produces an empty list — a valid,
 * expected outcome, not an error.
 */
export function planNotifications(
  inputs: DispatchInputs,
): readonly { readonly id: string; readonly doc: NotificationDoc }[] {
  // `adminUids` is part of `DispatchInputs` as the seam for a future per-admin fan-out, but
  // v1.0's admin notification is a single shared document with a `readBy` map, so it is not
  // consumed here.
  const { event, content, ttlDays } = inputs;
  const route = NOTIFICATION_ROUTES[event.type];
  const values = interpolationValues(event.payload, content);
  const createdAt = event.at;
  const expiresAt = new Date(createdAt.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  const results: { id: string; doc: NotificationDoc }[] = [];

  // Customer notification — addressed to the uid the payload carries, when the route and
  // the payload both name one.
  const customerUid = customerRecipient(event.payload);
  if (route.customer !== null && customerUid !== null) {
    const rendered = render(content, route.customer, values);
    results.push({
      id: notificationId(event.id, 'user', customerUid),
      doc: {
        eventId: event.id,
        audience: 'user',
        userId: customerUid,
        type: route.customer,
        title: rendered.title,
        body: rendered.body,
        link: linkFor(event.payload),
        readAt: null,
        readBy: {},
        createdAt,
        expiresAt,
      },
    });
  }

  // Admin notification — a single shared document with a per-admin read map. The recipient
  // component of the ID is `null` ("all"), so the event produces exactly one admin document
  // however many admins there are; each reads it independently via `readBy`.
  if (route.admin !== null) {
    const rendered = render(content, route.admin, values);
    results.push({
      id: notificationId(event.id, 'admin', null),
      doc: {
        eventId: event.id,
        audience: 'admin',
        userId: null,
        type: route.admin,
        title: rendered.title,
        body: rendered.body,
        link: adminLinkFor(event.payload),
        readAt: null,
        // Seeded so the schema's shape holds; each admin adds their own key on read. Absent
        // uid means unread, which is what the bell counts.
        readBy: {},
        createdAt,
        expiresAt,
      },
    });
  }

  return results;
}

/** Renders a template with the interpolation values, filling `{token}` placeholders. */
function render(
  content: NotificationContent,
  type: NotificationType,
  values: Readonly<Record<string, string>>,
): { title: string; body: string } {
  const template = content.templates[type];
  return {
    title: interpolate(template.title, values),
    body: interpolate(template.body, values),
  };
}

/**
 * Fills `{token}` placeholders. An unknown token is left in place rather than blanked, so a
 * template referencing a token the payload does not supply is visible in the notification
 * rather than silently producing "shipped with ." — though template validation catches that
 * at build time, this is the honest fallback if one slips through.
 */
function interpolate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replaceAll(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

/**
 * Builds the interpolation values for an event payload — the union of every token any
 * template might reference. Only the fields present on this payload are set; the rest are
 * absent, and `interpolate` leaves their placeholders untouched (build-time validation
 * ensures no template references an absent one).
 */
function interpolationValues(
  payload: EventPayload,
  content: NotificationContent,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};

  if ('humanId' in payload) values.orderRef = payload.humanId;
  if ('totalMinor' in payload) {
    values.amount = formatMoney(payload.totalMinor, content.moneyFormat);
  }
  if ('amountMinor' in payload) {
    values.amount = formatMoney(payload.amountMinor, content.moneyFormat);
  }
  if ('carrier' in payload) values.carrier = payload.carrier;
  if ('trackingNo' in payload) values.trackingNo = payload.trackingNo;
  if ('sku' in payload) values.sku = payload.sku;
  if ('addressLabel' in payload) values.addressLabel = payload.addressLabel;

  return values;
}

/** The customer uid an event is about, or null if it has no single customer recipient. */
function customerRecipient(payload: EventPayload): NotificationDoc['userId'] {
  return 'userId' in payload ? payload.userId : null;
}

/**
 * The in-app deep link for a customer notification. A **path**, not an absolute URL — the
 * origin differs per store, and the client resolves it against its own origin.
 */
function linkFor(payload: EventPayload): string {
  if ('humanId' in payload) return `/account/orders/${payload.humanId}`;
  if ('productSlug' in payload) return `/p/${payload.productSlug}`;
  return '/account';
}

/** The deep link for an admin notification, into the backoffice. */
function adminLinkFor(payload: EventPayload): string {
  if ('orderId' in payload) return `/orders/${payload.orderId}`;
  if ('reviewId' in payload) return `/reviews`;
  if ('sku' in payload) return `/inventory`;
  return '/';
}
