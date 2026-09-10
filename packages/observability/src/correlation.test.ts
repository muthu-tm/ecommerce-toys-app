import { describe, expect, it } from 'vitest';

import {
  getRequestContext,
  getRequestId,
  resolveRequestId,
  runWithRequestContext,
} from './correlation';

describe('request context', () => {
  it('is undefined outside a request', () => {
    expect(getRequestContext()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
  });

  it('is readable inside a request', () => {
    runWithRequestContext({ requestId: 'req-1', uid: 'uid-1' }, () => {
      expect(getRequestId()).toBe('req-1');
      expect(getRequestContext()).toMatchObject({ requestId: 'req-1', uid: 'uid-1' });
    });
  });

  it('does not leak out of the callback', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => undefined);

    expect(getRequestContext()).toBeUndefined();
  });

  it('survives await boundaries', async () => {
    await runWithRequestContext({ requestId: 'req-async' }, async () => {
      await Promise.resolve();
      expect(getRequestId()).toBe('req-async');
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getRequestId()).toBe('req-async');
    });
  });

  it('keeps concurrent requests separate', async () => {
    // The property that makes ambient context safe on a server handling parallel
    // requests. If this failed, log lines would be attributed to the wrong request.
    const observed = await Promise.all([
      runWithRequestContext({ requestId: 'req-a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getRequestId();
      }),
      runWithRequestContext({ requestId: 'req-b' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getRequestId();
      }),
    ]);

    expect(observed).toEqual(['req-a', 'req-b']);
  });

  it('nests, with the inner context winning', () => {
    runWithRequestContext({ requestId: 'outer' }, () => {
      runWithRequestContext({ requestId: 'inner' }, () => {
        expect(getRequestId()).toBe('inner');
      });
      expect(getRequestId()).toBe('outer');
    });
  });

  it('returns the callback result', () => {
    expect(runWithRequestContext({ requestId: 'r' }, () => 42)).toBe(42);
  });
});

describe('resolveRequestId', () => {
  it('mints one when there is no inbound header', () => {
    expect(resolveRequestId()).toMatch(/^[0-9a-f-]{36}$/u);
    expect(resolveRequestId(null)).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('accepts a well-formed inbound value', () => {
    expect(resolveRequestId('01JD8Z3K7Q')).toBe('01JD8Z3K7Q');
    expect(resolveRequestId('trace-1.2:3')).toBe('trace-1.2:3');
  });

  it('takes the first value when a header repeats', () => {
    expect(resolveRequestId(['first', 'second'])).toBe('first');
  });

  it('strips characters that would forge a log line or inject a header', () => {
    // The value is echoed into a response header and into log lines, so a newline
    // from a client would let it write its own log entries or append a header.
    // Colons and hyphens survive, because real trace IDs use them and they are
    // harmless once CR and LF are gone.
    const sanitised = resolveRequestId('abc\r\nX-Admin: true');

    expect(sanitised).not.toMatch(/[\r\n]/u);
    expect(sanitised).not.toContain(' ');
    expect(sanitised).toBe('abcX-Admin:true');
    expect(resolveRequestId('a\nb')).toBe('ab');
  });

  it('caps the length', () => {
    expect(resolveRequestId('a'.repeat(500))).toHaveLength(128);
  });

  it('falls back to a fresh ID when nothing usable survives sanitising', () => {
    expect(resolveRequestId('!!!')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(resolveRequestId('')).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('mints distinct IDs', () => {
    expect(resolveRequestId()).not.toBe(resolveRequestId());
  });
});
