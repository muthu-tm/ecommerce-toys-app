import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  ValidationFailedError,
} from './errors';
import { createLogger } from './logger';
import {
  createLoggingReporter,
  createNoopReporter,
  isReportable,
  reportIfUnexpected,
} from './reporter';

describe('isReportable', () => {
  it('reports server faults', () => {
    expect(isReportable(new InternalError('kaboom'))).toBe(true);
  });

  it('reports anything that is not an AppError', () => {
    // An unrecognised throw is by definition unexpected.
    expect(isReportable(new Error('plain'))).toBe(true);
    expect(isReportable('a string')).toBe(true);
    expect(isReportable(undefined)).toBe(true);
  });

  it('does not report expected client outcomes', () => {
    // A dashboard full of 404s and validation errors is a dashboard nobody reads,
    // and then a real incident goes unnoticed.
    expect(isReportable(new NotFoundError())).toBe(false);
    expect(isReportable(new ForbiddenError())).toBe(false);
    expect(isReportable(new ValidationFailedError([]))).toBe(false);
    expect(isReportable(new RateLimitedError(30))).toBe(false);
  });
});

describe('reportIfUnexpected', () => {
  it('forwards only unexpected errors', () => {
    const reporter = { ...createNoopReporter(), captureException: vi.fn() };

    reportIfUnexpected(reporter, new NotFoundError());
    expect(reporter.captureException).not.toHaveBeenCalled();

    reportIfUnexpected(reporter, new InternalError('kaboom'), { requestId: 'req-1' });
    expect(reporter.captureException).toHaveBeenCalledTimes(1);
    expect(reporter.captureException).toHaveBeenCalledWith(expect.any(InternalError), {
      requestId: 'req-1',
    });
  });
});

describe('createNoopReporter', () => {
  it('accepts everything and does nothing', async () => {
    const reporter = createNoopReporter();

    expect(() => {
      reporter.captureException(new Error('x'));
      reporter.captureMessage('x');
    }).not.toThrow();
    await expect(reporter.flush()).resolves.toBeUndefined();
  });
});

describe('createLoggingReporter', () => {
  function capture(): { readonly lines: Record<string, unknown>[]; stream: Writable } {
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

  it('logs an exception at error level with its context', () => {
    const { lines, stream } = capture();
    const reporter = createLoggingReporter(createLogger({ name: 'api', destination: stream }));

    reporter.captureException(new InternalError('kaboom'), {
      requestId: 'req-1',
      route: 'POST /v1/orders',
    });

    expect(lines[0]).toMatchObject({
      level: 'error',
      requestId: 'req-1',
      route: 'POST /v1/orders',
    });
    expect(lines[0]?.err).toMatchObject({ message: 'kaboom' });
  });

  it('normalises a plain throw into an AppError before logging', () => {
    const { lines, stream } = capture();
    const reporter = createLoggingReporter(createLogger({ name: 'api', destination: stream }));

    reporter.captureException('a bare string');

    expect(lines[0]?.err).toMatchObject({ name: 'InternalError' });
  });

  it('redacts PII carried in report context', () => {
    // Report context is developer-supplied, so it is exactly where a phone number
    // gets attached "just for debugging".
    const { lines, stream } = capture();
    const reporter = createLoggingReporter(createLogger({ name: 'api', destination: stream }));

    reporter.captureException(new InternalError('kaboom'), {
      requestId: 'req-1',
      extra: { email: 'asha@example.com', phone: '+919845021174' },
    });

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain('asha@example.com');
    expect(serialised).not.toContain('9845021174');
  });

  it('logs a message at warn level', () => {
    const { lines, stream } = capture();
    const reporter = createLoggingReporter(createLogger({ name: 'api', destination: stream }));

    reporter.captureMessage('sweeper backlog growing', { route: 'scheduler' });

    expect(lines[0]).toMatchObject({
      level: 'warn',
      message: 'sweeper backlog growing',
      route: 'scheduler',
    });
  });

  it('has a flush that resolves, so Cloud Functions can await it', () => {
    const { stream } = capture();
    const reporter = createLoggingReporter(createLogger({ name: 'api', destination: stream }));

    return expect(reporter.flush(100)).resolves.toBeUndefined();
  });
});
