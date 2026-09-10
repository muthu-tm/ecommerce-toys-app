import { describe, expect, it } from 'vitest';

import { DEFAULT_REDACTED_KEYS, REDACTED, createRedactor, redact } from './redact';

describe('redact', () => {
  it('leaves ordinary values alone', () => {
    expect(redact({ orderId: 'order-1', totalMinor: 384_998, isGift: false })).toEqual({
      orderId: 'order-1',
      totalMinor: 384_998,
      isGift: false,
    });
  });

  it('redacts a login identifier at the top level', () => {
    expect(redact({ email: 'asha@example.com', phone: '+919845021174' })).toEqual({
      email: REDACTED,
      phone: REDACTED,
    });
  });

  it('redacts at any depth', () => {
    // The shape a developer happens to log is rarely the flat shape a path list
    // anticipates. This is the case pino's `redact.paths` would miss.
    const line = redact({
      order: {
        humanId: 'RMP-24817',
        contact: { email: 'asha@example.com', phone: '+919845021174' },
        shippingAddress: { line1: '1 Road', city: 'Bengaluru' },
      },
    });

    expect(line).toEqual({
      order: {
        humanId: 'RMP-24817',
        contact: { email: REDACTED, phone: REDACTED },
        shippingAddress: REDACTED,
      },
    });
  });

  it('redacts inside arrays', () => {
    expect(redact({ users: [{ uid: 'a', email: 'a@example.com' }] })).toEqual({
      users: [{ uid: 'a', email: REDACTED }],
    });
  });

  it('matches key names regardless of case or separators', () => {
    const line = redact({
      phoneNumber: '+91',
      phone_number: '+91',
      PhoneNumber: '+91',
      'mobile-number': '+91',
    }) as Record<string, unknown>;

    for (const value of Object.values(line)) {
      expect(value).toBe(REDACTED);
    }
  });

  it('does not walk a redacted subtree', () => {
    // Redaction is decided by key name before the value is inspected, so nothing
    // inside can leak through a nested field.
    expect(redact({ address: { line1: 'x', nested: { deeper: 'y' } } })).toEqual({
      address: REDACTED,
    });
  });

  it('does not over-redact fields that merely mention a sensitive word', () => {
    // Substring matching would blank these. They disclose nothing and are useful
    // when debugging, and over-redaction that hides signal gets the whole mechanism
    // switched off eventually.
    expect(
      redact({ emailVerified: true, hasPhone: false, primaryIdentifierType: 'phone' }),
    ).toEqual({ emailVerified: true, hasPhone: false, primaryIdentifierType: 'phone' });
  });

  it('redacts credentials and payment references', () => {
    const line = redact({
      password: 'hunter2',
      authorization: 'Bearer abc',
      idToken: 'eyJ',
      utr: '412345678901',
      screenshotPath: 'payment-proofs/o1/u1/a.jpg',
    }) as Record<string, unknown>;

    for (const value of Object.values(line)) {
      expect(value).toBe(REDACTED);
    }
  });

  it('survives a circular reference', () => {
    // A logger that hangs takes the request with it.
    const node: Record<string, unknown> = { id: 'a' };
    node.self = node;

    expect(redact(node)).toEqual({ id: 'a', self: '[circular]' });
  });

  it('renders a shared object twice rather than calling the second one circular', () => {
    // Shared is not circular. Tracking every object ever seen, instead of the
    // current ancestor path, would silently drop the second copy from the log.
    const shared = { id: 'shared' };

    expect(redact({ first: shared, second: shared })).toEqual({
      first: { id: 'shared' },
      second: { id: 'shared' },
    });
  });

  it('detects a cycle through an intermediate object', () => {
    const parent: Record<string, unknown> = { id: 'parent' };
    parent.child = { id: 'child', parent };

    expect(redact(parent)).toEqual({
      id: 'parent',
      child: { id: 'child', parent: '[circular]' },
    });
  });

  it('truncates beyond the depth limit', () => {
    const deep = { a: { b: { c: { d: 'too deep' } } } };

    expect(redact(deep, { maxDepth: 2 })).toEqual({
      a: { b: { c: '[truncated: max depth]' } },
    });
  });

  it('truncates a long array and says how many were dropped', () => {
    const result = redact({ items: Array.from({ length: 5 }, (_, i) => i) }, { maxArrayLength: 2 });

    expect(result).toEqual({ items: [0, 1, '[truncated: 3 more]'] });
  });

  it('serialises an Error with its stack rather than as an empty object', () => {
    const error = new Error('boom');
    const result = redact({ err: error }) as { err: Record<string, unknown> };

    expect(result.err.name).toBe('Error');
    expect(result.err.message).toBe('boom');
    expect(result.err.stack).toContain('boom');
  });

  it('follows an error cause chain', () => {
    const root = new Error('root cause');
    const wrapper = new Error('wrapper', { cause: root });
    const result = redact({ err: wrapper }) as {
      err: { cause?: Record<string, unknown> };
    };

    expect(result.err.cause?.message).toBe('root cause');
  });

  it('converts dates, bigints, maps and sets', () => {
    const result = redact({
      at: new Date('2026-09-09T00:00:00.000Z'),
      big: 10n,
      map: new Map([['email', 'a@example.com'] as const]),
      set: new Set(['a', 'b']),
    }) as Record<string, unknown>;

    expect(result.at).toBe('2026-09-09T00:00:00.000Z');
    expect(result.big).toBe('10');
    expect(result.map).toEqual({ email: REDACTED });
    expect(result.set).toEqual(['a', 'b']);
  });

  it('passes through null and undefined', () => {
    expect(redact({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
    expect(redact(null)).toBeNull();
    expect(redact('a string')).toBe('a string');
  });
});

describe('createRedactor options', () => {
  it('accepts additional keys', () => {
    const redactor = createRedactor({ additionalKeys: ['internalNote'] });

    expect(redactor({ internalNote: 'private' })).toEqual({ internalNote: REDACTED });
  });

  it('allows a default key to be kept deliberately', () => {
    // For a job that genuinely needs to log an address, e.g. a courier handoff.
    const redactor = createRedactor({ allowKeys: ['pincode'] });

    expect(redactor({ pincode: '560001', phone: '+91' })).toEqual({
      pincode: '560001',
      phone: REDACTED,
    });
  });

  it('is reusable across calls without leaking cycle state between them', () => {
    const redactor = createRedactor();
    const shared = { id: 'x' };

    // A WeakSet reused across calls would report the second call as circular.
    expect(redactor({ shared })).toEqual({ shared: { id: 'x' } });
    expect(redactor({ shared })).toEqual({ shared: { id: 'x' } });
  });
});

describe('DEFAULT_REDACTED_KEYS', () => {
  it('covers everything docs/SECURITY.md promises', () => {
    for (const key of ['phone', 'email', 'utr', 'password', 'authorization']) {
      expect(DEFAULT_REDACTED_KEYS).toContain(key);
    }
  });

  it('is normalised and free of duplicates', () => {
    expect(new Set(DEFAULT_REDACTED_KEYS).size).toBe(DEFAULT_REDACTED_KEYS.length);
    for (const key of DEFAULT_REDACTED_KEYS) {
      expect(key).toBe(key.toLowerCase().replaceAll(/[^a-z0-9]/gu, ''));
    }
  });
});
