import { describe, expect, it } from 'vitest';

import {
  ERROR_DEFINITIONS,
  ErrorCodeSchema,
  errorTitle,
  errorTypeUri,
  httpStatusForErrorCode,
  isDetailExposable,
} from './error-codes';
import { ProblemDetailsSchema } from './problem';

describe('error catalogue', () => {
  it('defines every code exactly once', () => {
    expect(Object.keys(ERROR_DEFINITIONS)).toHaveLength(ErrorCodeSchema.options.length);
    for (const code of ErrorCodeSchema.options) {
      expect(ERROR_DEFINITIONS[code]).toBeDefined();
    }
  });

  it('uses status codes in the 4xx/5xx range', () => {
    for (const code of ErrorCodeSchema.options) {
      const status = httpStatusForErrorCode(code);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThanOrEqual(599);
    }
  });

  it('gives each code a distinct type URI', () => {
    const uris = ErrorCodeSchema.options.map((code) => errorTypeUri(code));

    expect(new Set(uris).size).toBe(uris.length);
    expect(errorTypeUri('INSUFFICIENT_STOCK')).toBe('https://romp.dev/errors/insufficient-stock');
  });

  it('exposes detail for every code except INTERNAL', () => {
    // The single most important row in the table: an unexpected failure must not
    // leak a stack trace, a Firestore message or an internal ID to a client.
    const notExposed = ErrorCodeSchema.options.filter((code) => !isDetailExposable(code));

    expect(notExposed).toEqual(['INTERNAL']);
  });

  it('maps ownership failures to 404, not 403', () => {
    // A 403 confirms the resource exists, which discloses information about
    // another customer's data.
    expect(httpStatusForErrorCode('NOT_FOUND')).toBe(404);
    expect(errorTitle('NOT_FOUND')).toBe('Not found');
  });

  it('keeps the documented status for each money-critical conflict', () => {
    expect(httpStatusForErrorCode('INSUFFICIENT_STOCK')).toBe(409);
    expect(httpStatusForErrorCode('DUPLICATE_PAYMENT_REFERENCE')).toBe(409);
    expect(httpStatusForErrorCode('REFUND_EXCEEDS_REFUNDABLE')).toBe(409);
    expect(httpStatusForErrorCode('RESERVATION_EXPIRED')).toBe(409);
    expect(httpStatusForErrorCode('WEAK_PASSWORD')).toBe(422);
    expect(httpStatusForErrorCode('RATE_LIMITED')).toBe(429);
  });

  it('titles every code without an empty string', () => {
    for (const code of ErrorCodeSchema.options) {
      expect(errorTitle(code).length).toBeGreaterThan(0);
    }
  });
});

describe('ProblemDetailsSchema', () => {
  it('accepts the documented error shape', () => {
    const problem = ProblemDetailsSchema.parse({
      type: 'https://romp.dev/errors/insufficient-stock',
      title: 'Insufficient stock',
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      detail: 'Only 2 units of BRK-2401 remain.',
      requestId: '01JD8Z3K7Q0000000000000000',
      errors: [{ path: 'items.0.qty', message: 'Requested 5, available 2' }],
    });

    expect(problem.code).toBe('INSUFFICIENT_STOCK');
    expect(problem.errors?.[0]?.path).toBe('items.0.qty');
  });

  it('accepts a minimal problem with no detail', () => {
    // What an INTERNAL response looks like: nothing but the correlation ID.
    const problem = ProblemDetailsSchema.parse({
      type: 'https://romp.dev/errors/internal',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL',
      requestId: 'req-1',
    });

    expect(problem.detail).toBeUndefined();
  });

  it('rejects a code outside the catalogue', () => {
    expect(
      ProblemDetailsSchema.safeParse({
        type: 'x',
        title: 'x',
        status: 400,
        code: 'MADE_UP_CODE',
      }).success,
    ).toBe(false);
  });

  it('rejects a status outside the error range', () => {
    expect(
      ProblemDetailsSchema.safeParse({ type: 'x', title: 'x', status: 200, code: 'NOT_FOUND' })
        .success,
    ).toBe(false);
  });
});
