import { describe, expect, it } from 'vitest';

import { ErrorCodeSchema, orderStatusMachine } from '@romp/contracts';

import {
  AppError,
  DuplicatePaymentReferenceError,
  ForbiddenError,
  IdentifierTakenError,
  InsufficientStockError,
  InternalError,
  InvalidStateTransitionError,
  NotFoundError,
  PaymentAmountMismatchError,
  RateLimitedError,
  RefundExceedsRefundableError,
  ReservationExpiredError,
  TooManyFilterValuesError,
  UnauthenticatedError,
  UnsupportedQueryError,
  ValidationFailedError,
  VariantInUseError,
  WeakPasswordError,
  assertTransition,
  isAppError,
  toAppError,
  toProblemDetails,
} from './errors';

const ALL_ERRORS: readonly AppError[] = [
  new ValidationFailedError([{ path: 'a', message: 'bad' }]),
  new TooManyFilterValuesError({ field: 'categorySlugs', supplied: 11, maximum: 10 }),
  new UnsupportedQueryError({
    limitation: 'one range field per query',
    detail: 'Filtering by price and sorting by rating cannot be combined.',
  }),
  new UnauthenticatedError(),
  new ForbiddenError(),
  new NotFoundError(),
  new IdentifierTakenError(),
  new InsufficientStockError({ sku: 'BRK-2401', requested: 5, available: 2 }),
  new ReservationExpiredError(),
  new DuplicatePaymentReferenceError(),
  new PaymentAmountMismatchError({ expectedMinor: 290976, paidMinor: 250000 }),
  new InvalidStateTransitionError(),
  new VariantInUseError(),
  new RefundExceedsRefundableError({ requestedMinor: 500, refundableMinor: 100 }),
  new WeakPasswordError(),
  new RateLimitedError(30),
  new InternalError('kaboom'),
];

describe('the taxonomy', () => {
  it('covers every code in the catalogue', () => {
    // A code with no error class is a code no handler can raise.
    const covered = new Set(ALL_ERRORS.map((error) => error.code));

    expect([...covered].sort()).toEqual([...ErrorCodeSchema.options].sort());
  });

  it('gives every error a status and title from the catalogue', () => {
    for (const error of ALL_ERRORS) {
      expect(error.httpStatus).toBeGreaterThanOrEqual(400);
      expect(error.title.length).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('is recognisable through instanceof and isAppError', () => {
    for (const error of ALL_ERRORS) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
      expect(isAppError(error)).toBe(true);
    }
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('a string')).toBe(false);
  });

  it('names each error after its class, for legible logs', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
    expect(new InsufficientStockError({ sku: 'S', requested: 1, available: 0 }).name).toBe(
      'InsufficientStockError',
    );
  });
});

describe('toProblemDetails', () => {
  it('renders the documented shape', () => {
    const problem = toProblemDetails(
      new InsufficientStockError({ sku: 'BRK-2401', requested: 5, available: 2 }),
      'req-1',
    );

    expect(problem).toMatchObject({
      type: 'https://romp.dev/errors/insufficient-stock',
      title: 'Insufficient stock',
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      requestId: 'req-1',
    });
    expect(problem.detail).toContain('BRK-2401');
  });

  it('never exposes detail for INTERNAL', () => {
    // The single most important assertion in this file. A stack trace, a Firestore
    // message or an internal document ID must not be readable off a response.
    const problem = toProblemDetails(
      new InternalError('Firestore: PERMISSION_DENIED on /orders/abc123', {
        context: { collection: 'orders' },
      }),
      'req-2',
    );

    expect(problem).toEqual({
      type: 'https://romp.dev/errors/internal',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL',
      requestId: 'req-2',
    });
    expect(JSON.stringify(problem)).not.toContain('PERMISSION_DENIED');
    expect(JSON.stringify(problem)).not.toContain('abc123');
  });

  it('never serialises context for any error', () => {
    // context is for logs. It routinely holds things a caller must not see.
    const problem = toProblemDetails(
      new NotFoundError({ context: { actualOwnerUid: 'someone-else', resource: 'order' } }),
      'req-3',
    );

    expect(JSON.stringify(problem)).not.toContain('someone-else');
  });

  it('includes field-level issues only for validation failures', () => {
    const validation = toProblemDetails(
      new ValidationFailedError([{ path: 'items.0.qty', message: 'Requested 5, available 2' }]),
    );
    const other = toProblemDetails(new ForbiddenError());

    expect(validation.errors).toEqual([
      { path: 'items.0.qty', message: 'Requested 5, available 2' },
    ]);
    expect(other.errors).toBeUndefined();
  });

  it('omits an empty issues array rather than sending errors: []', () => {
    expect(toProblemDetails(new ValidationFailedError([])).errors).toBeUndefined();
  });

  it('includes retryAfterSeconds only on rate limiting', () => {
    expect(toProblemDetails(new RateLimitedError(30)).retryAfterSeconds).toBe(30);
    expect(toProblemDetails(new ForbiddenError()).retryAfterSeconds).toBeUndefined();
  });

  it('rounds a fractional retry-after up to at least one second', () => {
    // Retry-After is an integer number of seconds, and 0 would invite an immediate
    // retry that is guaranteed to fail again.
    expect(new RateLimitedError(0.2).retryAfterSeconds).toBe(1);
    expect(new RateLimitedError(4.1).retryAfterSeconds).toBe(5);
  });

  it('omits requestId when there is none', () => {
    expect(toProblemDetails(new ForbiddenError()).requestId).toBeUndefined();
  });
});

describe('ownership failures', () => {
  it('uses 404, not 403, for a resource the caller does not own', () => {
    // A 403 confirms the resource exists, which discloses another customer's data.
    const error = NotFoundError.forHiddenResource('order', { orderId: 'order-1' });

    expect(error.httpStatus).toBe(404);
    expect(error.context).toMatchObject({ resource: 'order', reason: 'not_owned_by_caller' });
    expect(toProblemDetails(error).detail).toBe('Not found.');
  });
});

describe('detail messages that must not disclose', () => {
  it('does not echo the identifier when registration collides', () => {
    // Otherwise the registration endpoint becomes an enumeration oracle.
    const detail = toProblemDetails(new IdentifierTakenError()).detail ?? '';

    expect(detail).not.toContain('@');
    expect(detail).toMatch(/already registered/);
  });

  it('does not name the order that claimed a duplicate payment reference', () => {
    const detail = toProblemDetails(new DuplicatePaymentReferenceError()).detail ?? '';

    expect(detail).toMatch(/already been used/);
    expect(detail).not.toMatch(/RMP-/);
  });
});

describe('InsufficientStockError', () => {
  it('reads naturally for one remaining unit', () => {
    expect(
      new InsufficientStockError({ sku: 'BRK-2401', requested: 2, available: 1 }).detail,
    ).toContain('1 unit of');
  });

  it('pluralises for zero or many', () => {
    expect(new InsufficientStockError({ sku: 'S', requested: 1, available: 0 }).detail).toContain(
      '0 units',
    );
  });

  it('produces a field path pointing at the offending cart line', () => {
    const error = new InsufficientStockError({ sku: 'S', requested: 5, available: 2 });

    expect(error.toIssues(3)).toEqual([
      { path: 'items.3.qty', message: 'Requested 5, available 2' },
    ]);
  });
});

describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new ForbiddenError();

    expect(toAppError(original)).toBe(original);
  });

  it('wraps a plain Error as INTERNAL and keeps the cause for logs', () => {
    const cause = new Error('socket hang up');
    const wrapped = toAppError(cause);

    expect(wrapped.code).toBe('INTERNAL');
    expect(wrapped.cause).toBe(cause);
    // The message survives for logging, but the response will not carry it.
    expect(wrapped.message).toBe('socket hang up');
    expect(toProblemDetails(wrapped).detail).toBeUndefined();
  });

  it('wraps a thrown non-error', () => {
    // `throw 'a string'` happens, usually from a dependency.
    const wrapped = toAppError('a string');

    expect(wrapped.code).toBe('INTERNAL');
    expect(wrapped.context).toMatchObject({ thrown: 'string' });
  });
});

describe('assertTransition', () => {
  it('permits a declared transition', () => {
    expect(() => {
      assertTransition(orderStatusMachine, 'pending_verification', 'paid');
    }).not.toThrow();
  });

  it('throws INVALID_STATE_TRANSITION for an illegal one', () => {
    // This is the bridge that lets contracts stay dependency-free: the machine
    // reports, this throws.
    let thrown: unknown;
    try {
      assertTransition(orderStatusMachine, 'cancelled', 'paid', { orderId: 'order-1' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InvalidStateTransitionError);
    const problem = toProblemDetails(thrown as AppError);
    expect(problem.status).toBe(409);
    expect(problem.code).toBe('INVALID_STATE_TRANSITION');
    expect(problem.detail).toContain('cancelled');
  });

  it('records the machine and the attempted move in context, not in the response', () => {
    try {
      assertTransition(orderStatusMachine, 'cancelled', 'paid', { orderId: 'order-1' });
      throw new Error('expected a throw');
    } catch (error) {
      if (!(error instanceof InvalidStateTransitionError)) throw error;
      expect(error.context).toMatchObject({
        machine: 'order status',
        from: 'cancelled',
        to: 'paid',
        orderId: 'order-1',
      });
    }
  });

  it('rejects an unknown state', () => {
    expect(() => {
      assertTransition(orderStatusMachine, 'not_a_state', 'paid');
    }).toThrow(InvalidStateTransitionError);
  });
});

describe('WeakPasswordError', () => {
  it('explains the policy without imposing composition rules', () => {
    // Composition rules reduce real entropy by pushing users to predictable
    // patterns, so the message must not ask for a symbol or a digit.
    const error = new WeakPasswordError();

    expect(error.httpStatus).toBe(422);
    expect(error.detail).toMatch(/10 characters/);
    expect(error.detail).not.toMatch(/uppercase|symbol|special character/i);
  });

  it('carries suggestions when given them', () => {
    expect(new WeakPasswordError({ suggestions: ['Add another word'] }).suggestions).toEqual([
      'Add another word',
    ]);
  });
});

describe('RefundExceedsRefundableError', () => {
  it('keeps the amounts in context for the audit trail', () => {
    const error = new RefundExceedsRefundableError({
      requestedMinor: 500_000,
      refundableMinor: 100_000,
    });

    expect(error.httpStatus).toBe(409);
    expect(error.context).toMatchObject({ requestedMinor: 500_000, refundableMinor: 100_000 });
  });
});

describe('TooManyFilterValuesError', () => {
  it('names the field, the count and the ceiling', () => {
    // "Too many values" without any of the three is a message the caller cannot act
    // on, and this error exists precisely so the caller can act on it.
    const error = new TooManyFilterValuesError({
      field: 'categorySlugs',
      supplied: 11,
      maximum: 10,
    });

    expect(error.message).toContain('categorySlugs');
    expect(error.message).toContain('10');
    expect(error.message).toContain('11');
  });

  it('is a 400, not a 500', () => {
    // The caller asked for something the datastore cannot serve. That is a bad
    // request, and the fix is theirs.
    const problem = toProblemDetails(
      new TooManyFilterValuesError({ field: 'ageBands', supplied: 12, maximum: 10 }),
    );

    expect(problem.status).toBe(400);
  });

  it('renders as a field-level issue', () => {
    const issues = new TooManyFilterValuesError({
      field: 'brands',
      supplied: 20,
      maximum: 10,
    }).toIssues();

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('brands');
  });

  it('carries the numbers in context, for the log line', () => {
    const error = new TooManyFilterValuesError({ field: 'brands', supplied: 20, maximum: 10 });

    expect(error.context).toMatchObject({ field: 'brands', supplied: 20, maximum: 10 });
  });
});

describe('UnsupportedQueryError', () => {
  it('records the limitation separately from the message', () => {
    // The set of unsupported queries shrinks when Typesense lands. Keeping the
    // limitation as a field means the errors that disappear are identifiable, rather
    // than being indistinguishable from real bad input.
    const error = new UnsupportedQueryError({
      limitation: 'one range field per query',
      detail: 'Filtering by price and sorting by rating cannot be combined.',
    });

    expect(error.limitation).toBe('one range field per query');
    expect(error.message).toContain('cannot be combined');
    expect(error.context).toMatchObject({ limitation: 'one range field per query' });
  });

  it('is a 400 and exposes its detail', () => {
    const problem = toProblemDetails(
      new UnsupportedQueryError({
        limitation: 'no full-text search',
        detail: 'Not supported yet.',
      }),
    );

    expect(problem.status).toBe(400);
    expect(problem.detail).toBe('Not supported yet.');
  });
});
