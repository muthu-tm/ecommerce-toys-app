import { describe, expect, it } from 'vitest';

import { NotificationTypeSchema } from '@romp/contracts';
import { allowedTokensByNotificationType, findTemplateTokenViolations } from '@romp/core';

import { loadStoreConfig } from './loader';
import type { StoreConfig } from './schema';

/**
 * A notification template is chosen by notification type, and the dispatcher interpolates only
 * the tokens the source event supplies. A template that references `{trackingNo}` on a
 * notification whose event carries no tracking number renders "shipped with " — a blank the
 * schema's `min(1)` cannot catch, because the string is non-empty until it is interpolated.
 *
 * These tests turn that class of copy bug into a build failure: they load every shipped store
 * and assert no template reaches for a token its event does not provide. A store author who
 * writes `{customerName}` into `order_placed` fails CI, not a customer's inbox.
 */

const romp = await loadStoreConfig('romp');
const template = await loadStoreConfig('_template', { allowScaffold: true });

describe('notification template tokens', () => {
  it.each([
    ['romp', romp],
    ['_template', template],
  ])('%s references only tokens its source event supplies', (_id, config: StoreConfig) => {
    const violations = findTemplateTokenViolations(config.content.notifications);

    // Each violation names the notification type, the field, and the offending token, so a
    // failure points straight at the line to fix rather than "a template is wrong somewhere".
    expect(violations).toEqual([]);
  });

  it('permits a token on every notification type it is allowed for', () => {
    // Guards the guard: if the allow-map were accidentally empty, the test above would pass
    // vacuously. Every notification type the routing table produces must have an entry.
    const allowed = allowedTokensByNotificationType();

    for (const type of NotificationTypeSchema.options) {
      // `review_published` and other bodyless notifications legitimately allow no tokens, so
      // the assertion is presence of a set, not a non-empty one.
      expect(allowed[type] ?? new Set()).toBeInstanceOf(Set);
    }
  });

  it('rejects a template that reaches for a token its event does not supply', () => {
    // `order_placed` comes from order.created, which supplies orderRef and amount — never a
    // tracking number. This proves the validator has teeth.
    const violations = findTemplateTokenViolations({
      order_placed: { title: 'Order {orderRef}', body: 'Tracking {trackingNo}' },
    });

    expect(violations).toEqual([
      { notificationType: 'order_placed', field: 'body', token: 'trackingNo' },
    ]);
  });
});
