import type { EventType, NotificationType } from '@romp/contracts';

import { NOTIFICATION_ROUTES } from './routing';

/**
 * Which interpolation tokens each notification template may legitimately use.
 *
 * A template that references `{trackingNo}` on a notification whose event has no tracking
 * number renders "shipped with " to a customer. This module makes that a **build-time**
 * failure instead: it computes, from the routing table and the tokens each event supplies,
 * the set of tokens every notification type is allowed to reference — and the store-config
 * test asserts no template reaches outside its set.
 *
 * The token set per notification type is the union across every event that routes to it,
 * because a template is chosen by notification type, not by event, and must render for any
 * event that produces it. In v1.0 each notification type has exactly one source event, but
 * the union is the correct rule regardless.
 */

/**
 * The interpolation tokens each **event** supplies, mirroring `planNotifications`'
 * `interpolationValues`. Kept beside the routing table so the two cannot drift: if the
 * dispatcher learns to interpolate a new token, it is added here and every template gains
 * permission to use it.
 */
const EVENT_TOKENS: Readonly<Record<EventType, readonly string[]>> = Object.freeze({
  'order.created': ['orderRef', 'amount'],
  'order.payment_submitted': ['orderRef'],
  'order.payment_verified': ['orderRef'],
  'order.payment_rejected': ['orderRef'],
  'order.expired': ['orderRef'],
  'order.packed': ['orderRef'],
  'order.shipped': ['orderRef', 'carrier', 'trackingNo'],
  'order.delivered': ['orderRef'],
  'order.cancelled': ['orderRef'],
  'refund.issued': ['orderRef', 'amount'],
  'review.submitted': [],
  'review.published': [],
  'review.rejected': [],
  'inventory.low_stock': ['sku'],
  'inventory.out_of_stock': ['sku'],
  'sweeper.anomaly': [],
});

/**
 * Builds the map of notification type → allowed tokens, by unioning the tokens of every
 * event that routes to that notification type.
 */
export function allowedTokensByNotificationType(): Readonly<Record<string, ReadonlySet<string>>> {
  const map = new Map<NotificationType, Set<string>>();

  for (const [eventType, route] of Object.entries(NOTIFICATION_ROUTES) as [
    EventType,
    (typeof NOTIFICATION_ROUTES)[EventType],
  ][]) {
    const tokens = EVENT_TOKENS[eventType];
    for (const notificationType of [route.customer, route.admin]) {
      if (notificationType === null) continue;
      const set = map.get(notificationType) ?? new Set<string>();
      for (const token of tokens) set.add(token);
      map.set(notificationType, set);
    }
  }

  return Object.fromEntries(map);
}

/** Extracts the `{token}` names referenced in a template string. */
export function tokensIn(template: string): readonly string[] {
  return [...template.matchAll(/\{(\w+)\}/gu)].map((match) => match[1] ?? '');
}

export interface TemplateTokenViolation {
  readonly notificationType: string;
  readonly field: 'title' | 'body';
  readonly token: string;
}

/**
 * Validates a store's notification templates against the allowed-token map.
 *
 * Returns every violation — a template referencing a token its event does not supply — so a
 * config test can report all of them at once rather than one per run. An empty array means
 * every template is safe to interpolate.
 */
export function findTemplateTokenViolations(
  templates: Readonly<Record<string, { readonly title: string; readonly body: string }>>,
): readonly TemplateTokenViolation[] {
  const allowed = allowedTokensByNotificationType();
  const violations: TemplateTokenViolation[] = [];

  for (const [notificationType, template] of Object.entries(templates)) {
    const permitted = allowed[notificationType] ?? new Set<string>();
    for (const field of ['title', 'body'] as const) {
      for (const token of tokensIn(template[field])) {
        if (!permitted.has(token)) {
          violations.push({ notificationType, field, token });
        }
      }
    }
  }

  return violations;
}
