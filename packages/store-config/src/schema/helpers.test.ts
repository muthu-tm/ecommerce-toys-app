import { describe, expect, it } from 'vitest';

import { buildWhatsappLink, buildWhatsappMessage } from './contact';
import { renderTemplate } from './content';

describe('buildWhatsappMessage', () => {
  it('interpolates the order reference', () => {
    expect(buildWhatsappMessage('Hi ROMP, I need help with {orderRef}.', 'RMP-24817')).toBe(
      'Hi ROMP, I need help with RMP-24817.',
    );
  });

  it('collapses the placeholder for a general enquiry', () => {
    // Without this the customer sends "I need help with  ." — the space before the
    // full stop is the giveaway that a template was not filled in.
    expect(buildWhatsappMessage('Hi ROMP, I need help with {orderRef}.')).toBe(
      'Hi ROMP, I need help with.',
    );
  });

  it('handles a placeholder at the start or end', () => {
    expect(buildWhatsappMessage('{orderRef} needs attention')).toBe('needs attention');
    expect(buildWhatsappMessage('About {orderRef}')).toBe('About');
  });

  it('leaves a greeting with no placeholder alone', () => {
    expect(buildWhatsappMessage('Hi, I have a question')).toBe('Hi, I have a question');
    expect(buildWhatsappMessage('Hi, I have a question', 'RMP-1')).toBe('Hi, I have a question');
  });

  it('replaces every occurrence', () => {
    expect(buildWhatsappMessage('{orderRef} — about {orderRef}', 'RMP-1')).toBe(
      'RMP-1 — about RMP-1',
    );
  });
});

describe('buildWhatsappLink', () => {
  const contact = {
    whatsappNumber: '+919845021174' as never,
    whatsappGreeting: 'Hi ROMP, I need help with {orderRef}.',
  };

  it('drops the leading plus, which wa.me does not accept', () => {
    const link = buildWhatsappLink(contact, 'RMP-24817');

    expect(link.startsWith('https://wa.me/919845021174?text=')).toBe(true);
    expect(link).not.toContain('/+91');
  });

  it('percent-encodes the message', () => {
    const link = buildWhatsappLink(contact, 'RMP-24817');

    expect(link).toContain('Hi%20ROMP');
    expect(link).toContain('RMP-24817');
    // A raw space would break the URL.
    expect(link).not.toMatch(/text=.*\s/u);
  });

  it('works without an order reference', () => {
    expect(buildWhatsappLink(contact)).toContain('text=Hi%20ROMP');
  });
});

describe('renderTemplate', () => {
  it('interpolates known placeholders', () => {
    expect(
      renderTemplate('Order {orderRef} shipped with {carrier}. Tracking: {trackingNo}.', {
        orderRef: 'RMP-24817',
        carrier: 'Delhivery',
        trackingNo: 'DL123',
      }),
    ).toBe('Order RMP-24817 shipped with Delhivery. Tracking: DL123.');
  });

  it('leaves an unknown placeholder visible rather than blanking it', () => {
    // A template typo should be obvious in the notification, not silently produce
    // "Your order  has shipped".
    expect(renderTemplate('Order {orderReff} shipped', { orderRef: 'RMP-1' })).toBe(
      'Order {orderReff} shipped',
    );
  });

  it('leaves a placeholder whose value is undefined', () => {
    expect(renderTemplate('Order {orderRef}', { orderRef: undefined })).toBe('Order {orderRef}');
  });

  it('replaces repeated placeholders', () => {
    expect(renderTemplate('{a} and {a}', { a: 'x' })).toBe('x and x');
  });

  it('returns copy with no placeholders unchanged', () => {
    expect(renderTemplate('Nothing to fill in', {})).toBe('Nothing to fill in');
  });

  it('does not treat braces with non-word content as placeholders', () => {
    expect(renderTemplate('a {b c} d', { b: 'x' })).toBe('a {b c} d');
  });
});
describe('the shipped greeting templates', () => {
  it('read naturally with and without an order reference', async () => {
    // A template like "I need help with {orderRef}." leaves "I need help with." on a
    // general enquiry, which looks like a bug to the customer. Every configured greeting
    // has to survive both renderings.
    const { loadStoreConfig } = await import('../loader');

    for (const storeId of ['romp', '_template']) {
      const config = await loadStoreConfig(storeId, { allowScaffold: true });
      const greeting = config.contact.whatsappGreeting;

      const general = buildWhatsappMessage(greeting);
      const withRef = buildWhatsappMessage(greeting, 'RMP-24817');

      expect(withRef, storeId).toContain('RMP-24817');
      // No dangling preposition or doubled punctuation left behind by the placeholder.
      expect(general, storeId).not.toMatch(/\s[.,!?]/u);
      expect(general, storeId).not.toMatch(/(with|for|about|regarding)\.$/iu);
      expect(general.length, storeId).toBeGreaterThan(0);
    }
  });
});
