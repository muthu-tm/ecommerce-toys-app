import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { runWithRequestContext } from './correlation';
import { createLogger, createSilentLogger } from './logger';
import { REDACTED } from './redact';

/**
 * Captures real serialised output.
 *
 * These tests deliberately go through pino's actual write path rather than spying on
 * a method. The claim being verified — "no PII reaches a log line" — is a property of
 * the serialised bytes, and a spy on `logger.info` would prove nothing about them.
 */
function captureLines(): { readonly lines: Record<string, unknown>[]; stream: Writable } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim().length > 0) lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('writes structured JSON with a level label and service name', () => {
    const { lines, stream } = captureLines();
    const logger = createLogger({ name: 'api', destination: stream });

    logger.info({ orderId: 'order-1' }, 'order placed');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      service: 'api',
      message: 'order placed',
      orderId: 'order-1',
    });
    // A numeric level is unreadable in log search.
    expect(lines[0]?.level).not.toBe(30);
  });

  it('emits an ISO timestamp', () => {
    const { lines, stream } = captureLines();
    createLogger({ name: 'api', destination: stream }).info('tick');

    expect(String(lines[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('redacts PII from a logged user object', () => {
    // This is the Task 3 demo assertion. A developer logging a whole document is the
    // realistic failure mode, and it must not leak.
    const { lines, stream } = captureLines();
    const logger = createLogger({ name: 'api', destination: stream });

    logger.info(
      {
        user: {
          uid: 'uid-1',
          displayName: 'Asha',
          email: 'asha@example.com',
          phone: '+919845021174',
          primaryIdentifierType: 'phone',
        },
      },
      'user loaded',
    );

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain('asha@example.com');
    expect(serialised).not.toContain('+919845021174');
    expect(serialised).not.toContain('9845021174');
    // Non-sensitive fields survive, or the log would be useless.
    expect(lines[0]).toMatchObject({
      user: {
        uid: 'uid-1',
        displayName: 'Asha',
        email: REDACTED,
        phone: REDACTED,
        primaryIdentifierType: 'phone',
      },
    });
  });

  it('redacts PII nested inside an order', () => {
    const { lines, stream } = captureLines();
    const logger = createLogger({ name: 'api', destination: stream });

    logger.warn(
      {
        order: {
          humanId: 'RMP-24817',
          totalMinor: 384_998,
          contact: { email: 'asha@example.com', phone: '+919845021174' },
          shippingAddress: { line1: '12 MG Road', city: 'Bengaluru', pincode: '560001' },
          payment: { utr: '412345678901', screenshotPath: 'payment-proofs/o1/u1/a.jpg' },
        },
      },
      'order under review',
    );

    const serialised = JSON.stringify(lines[0]);
    for (const secret of [
      'asha@example.com',
      '+919845021174',
      '412345678901',
      '12 MG Road',
      'payment-proofs',
    ]) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret);
    }
    // The order is still identifiable and the amount still auditable.
    expect(serialised).toContain('RMP-24817');
    expect(serialised).toContain('384998');
  });

  it('redacts an authorization header', () => {
    const { lines, stream } = captureLines();
    createLogger({ name: 'api', destination: stream }).info(
      { req: { headers: { authorization: 'Bearer eyJhbGciOi', 'x-request-id': 'req-1' } } },
      'request',
    );

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain('eyJhbGciOi');
    expect(serialised).toContain('req-1');
  });

  it('attaches the correlation ID from the ambient request context', () => {
    // Injected rather than passed, because a caller who has to remember eventually
    // will not.
    const { lines, stream } = captureLines();
    const logger = createLogger({ name: 'api', destination: stream });

    runWithRequestContext({ requestId: 'req-42', uid: 'uid-1', route: 'POST /v1/orders' }, () => {
      logger.info('inside a request');
    });
    logger.info('outside a request');

    expect(lines[0]).toMatchObject({
      requestId: 'req-42',
      uid: 'uid-1',
      route: 'POST /v1/orders',
    });
    expect(lines[1]?.requestId).toBeUndefined();
  });

  it('keeps the correlation ID across an await boundary', () => {
    const { lines, stream } = captureLines();
    const logger = createLogger({ name: 'api', destination: stream });

    return runWithRequestContext({ requestId: 'req-async' }, async () => {
      await Promise.resolve();
      logger.info('after await');
      expect(lines[0]).toMatchObject({ requestId: 'req-async' });
    });
  });

  it('serialises an error with its stack under the err key', () => {
    const { lines, stream } = captureLines();
    createLogger({ name: 'api', destination: stream }).error(
      { err: new Error('boom') },
      'handler failed',
    );

    expect(lines[0]?.err).toMatchObject({ name: 'Error', message: 'boom' });
    expect(String((lines[0]?.err as Record<string, unknown>).stack)).toContain('boom');
  });

  it('respects the configured level', () => {
    const { lines, stream } = captureLines();
    const logger = createLogger({ name: 'api', level: 'warn', destination: stream });

    logger.debug('not written');
    logger.info('not written either');
    logger.warn('written');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ message: 'written' });
  });

  it('accepts extra base fields for every line', () => {
    const { lines, stream } = captureLines();
    createLogger({
      name: 'api',
      base: { release: 'v1.0.0', storeId: 'romp' },
      destination: stream,
    }).info('hello');

    expect(lines[0]).toMatchObject({ release: 'v1.0.0', storeId: 'romp' });
  });

  it('accepts additional redaction keys', () => {
    const { lines, stream } = captureLines();
    createLogger({
      name: 'api',
      redact: { additionalKeys: ['internalNote'] },
      destination: stream,
    }).info({ internalNote: 'do not log me' }, 'note');

    expect(JSON.stringify(lines[0])).not.toContain('do not log me');
  });

  it('survives a circular object without hanging', () => {
    const { lines, stream } = captureLines();
    const node: Record<string, unknown> = { id: 'a' };
    node.self = node;

    createLogger({ name: 'api', destination: stream }).info({ node }, 'circular');

    expect(lines[0]).toMatchObject({ node: { id: 'a', self: '[circular]' } });
  });
});

describe('createSilentLogger', () => {
  it('discards everything', () => {
    const logger = createSilentLogger();

    expect(() => {
      logger.info({ email: 'asha@example.com' }, 'ignored');
      logger.error('ignored');
    }).not.toThrow();
    expect(logger.level).toBe('silent');
  });
});
