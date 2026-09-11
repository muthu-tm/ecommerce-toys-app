import { describe, expect, it } from 'vitest';

import { EventTypeSchema, NotificationTypeSchema } from '@romp/contracts';

import { NOTIFICATION_ROUTES } from './routing';
import { allowedTokensByNotificationType, findTemplateTokenViolations, tokensIn } from './tokens';

/**
 * The token rule derives from the routing table: a notification type may use exactly the
 * tokens supplied by the events that route to it. These tests pin the derivation and the
 * validator so the pure logic is covered in `@romp/core`; the store-config suite applies it
 * to the real shipped configs.
 */

describe('tokensIn', () => {
  it('extracts every {token} in order', () => {
    expect(tokensIn('Order {orderRef} for {amount}')).toEqual(['orderRef', 'amount']);
  });

  it('returns an empty list for a template with no tokens', () => {
    expect(tokensIn('Your order was placed')).toEqual([]);
  });

  it('ignores braces that are not word tokens', () => {
    // The interpolator only replaces `{word}`, so `{}` and `{ spaced }` are literal text and
    // must not be reported as tokens a validator would police.
    expect(tokensIn('empty {} and { spaced }')).toEqual([]);
  });
});

describe('allowedTokensByNotificationType', () => {
  it('gives order_placed the tokens order.created supplies', () => {
    const allowed = allowedTokensByNotificationType();

    expect([...(allowed.order_placed ?? [])].sort()).toEqual(['amount', 'orderRef']);
  });

  it('gives order_shipped the carrier and tracking tokens', () => {
    const allowed = allowedTokensByNotificationType();

    expect([...(allowed.order_shipped ?? [])].sort()).toEqual([
      'carrier',
      'orderRef',
      'trackingNo',
    ]);
  });

  it('gives inventory alerts only the sku token', () => {
    const allowed = allowedTokensByNotificationType();

    expect([...(allowed.low_stock ?? [])]).toEqual(['sku']);
    expect([...(allowed.out_of_stock ?? [])]).toEqual(['sku']);
  });

  it('gives bodyless notifications an empty token set', () => {
    // review_published is produced by review.published, which supplies no interpolation
    // values — its template is static, so its allow-set is empty (not absent).
    const allowed = allowedTokensByNotificationType();

    expect([...(allowed.review_published ?? [])]).toEqual([]);
  });

  it('has an entry for every notification type the routing table produces', () => {
    const allowed = allowedTokensByNotificationType();
    const produced = new Set(
      EventTypeSchema.options.flatMap((type) => {
        const route = NOTIFICATION_ROUTES[type];
        return [route.customer, route.admin].filter((t) => t !== null);
      }),
    );

    for (const type of produced) {
      expect(allowed[type], `missing allow-set for ${type}`).toBeDefined();
    }
  });

  it('never allows a token outside the known interpolation vocabulary', () => {
    // The union of every allow-set is exactly the tokens the dispatcher can interpolate.
    const vocabulary = new Set([
      'orderRef',
      'amount',
      'carrier',
      'trackingNo',
      'sku',
      'addressLabel',
    ]);
    const allowed = allowedTokensByNotificationType();

    for (const tokens of Object.values(allowed)) {
      for (const token of tokens) {
        expect(vocabulary.has(token), `unexpected token ${token}`).toBe(true);
      }
    }
  });
});

describe('findTemplateTokenViolations', () => {
  it('reports nothing when every template stays within its allow-set', () => {
    const violations = findTemplateTokenViolations({
      order_placed: { title: 'Order {orderRef}', body: 'Total {amount}' },
      order_shipped: { title: 'Shipped', body: '{carrier} {trackingNo}' },
    });

    expect(violations).toEqual([]);
  });

  it('reports a token an event does not supply, naming type field and token', () => {
    const violations = findTemplateTokenViolations({
      order_placed: { title: 'Hi {customerName}', body: 'Total {amount}' },
    });

    expect(violations).toEqual([
      { notificationType: 'order_placed', field: 'title', token: 'customerName' },
    ]);
  });

  it('reports violations in both title and body', () => {
    const violations = findTemplateTokenViolations({
      low_stock: { title: 'Low on {sku} at {carrier}', body: 'Only {trackingNo} left' },
    });

    expect(violations).toEqual([
      { notificationType: 'low_stock', field: 'title', token: 'carrier' },
      { notificationType: 'low_stock', field: 'body', token: 'trackingNo' },
    ]);
  });

  it('treats an unknown notification type as allowing no tokens', () => {
    // A template keyed by a type the routing table never produces has no allow-set, so any
    // token it uses is a violation — the safe default for a stray key.
    const type = 'not_a_real_type';
    const violations = findTemplateTokenViolations({
      [type]: { title: '{orderRef}', body: 'static' },
    });

    expect(violations).toEqual([{ notificationType: type, field: 'title', token: 'orderRef' }]);
  });

  it('accepts a static template with no tokens for any type', () => {
    const violations = findTemplateTokenViolations(
      Object.fromEntries(
        NotificationTypeSchema.options.map((type) => [type, { title: 'Update', body: 'Static.' }]),
      ),
    );

    expect(violations).toEqual([]);
  });
});
