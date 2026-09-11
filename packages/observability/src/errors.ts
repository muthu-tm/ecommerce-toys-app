import {
  type ErrorCode,
  type ProblemDetails,
  type StateMachine,
  type ValidationIssue,
  describeTransitionFailure,
  errorTitle,
  errorTypeUri,
  httpStatusForErrorCode,
  isDetailExposable,
} from '@romp/contracts';

/**
 * The error taxonomy.
 *
 * One base class, one subclass per catalogue entry, and exactly one place that turns
 * an error into an HTTP response. The rule the whole design exists to enforce:
 * **internal detail never reaches a client**. An unexpected failure becomes a bare
 * 500 carrying nothing but the correlation ID, so a stack trace, a Firestore message
 * or an internal document ID cannot be read off a response.
 *
 * `context` is the escape valve. Anything a responder would find useful but a caller
 * must not see goes there: it is logged (after redaction) and never serialised into
 * the response body.
 */

export interface AppErrorOptions {
  /** Human-readable explanation of this occurrence. Shown to callers except on INTERNAL. */
  readonly detail?: string;
  /** Structured data for logs only. Never serialised into a response. */
  readonly context?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;

  readonly detail: string | undefined;
  readonly context: Readonly<Record<string, unknown>> | undefined;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.detail = options.detail ?? message;
    this.context = options.context;
    // Without this, `instanceof` fails for subclasses when the output targets ES5.
    // The target here is ES2022, but subclass authors should not have to know that.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  get httpStatus(): number {
    return httpStatusForErrorCode(this.code);
  }

  get title(): string {
    return errorTitle(this.code);
  }
}

// --- 400 --------------------------------------------------------------------

export class ValidationFailedError extends AppError {
  readonly code = 'VALIDATION_FAILED' as const;
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[], options: AppErrorOptions = {}) {
    super(options.detail ?? 'One or more fields are invalid.', options);
    this.issues = issues;
  }
}

/**
 * A filter carried more values than the datastore accepts.
 *
 * Firestore caps `in` and `array-contains-any` at ten values. This is thrown rather
 * than truncating to the first ten, because a truncated filter returns *wrong* results
 * that look exactly like right ones — the customer sees a shorter list and has no way
 * to know the eleventh category was dropped. A visible 400 is recoverable; a silent
 * wrong answer is not (ADR-0002).
 *
 * The message names the field and the ceiling, because "too many values" without
 * either is a message the caller cannot act on.
 */
export class TooManyFilterValuesError extends AppError {
  readonly code = 'FILTER_LIMIT_EXCEEDED' as const;
  readonly field: string;
  readonly supplied: number;
  readonly maximum: number;

  constructor(
    params: { readonly field: string; readonly supplied: number; readonly maximum: number },
    options: AppErrorOptions = {},
  ) {
    super(
      options.detail ??
        `Select at most ${String(params.maximum)} values for ${params.field}; ${String(params.supplied)} were given.`,
      {
        ...options,
        context: {
          field: params.field,
          supplied: params.supplied,
          maximum: params.maximum,
          ...options.context,
        },
      },
    );
    this.field = params.field;
    this.supplied = params.supplied;
    this.maximum = params.maximum;
  }

  /** Field-level form of the failure, for an API response that highlights the input. */
  toIssues(): readonly ValidationIssue[] {
    return [{ path: this.field, message: this.message }];
  }
}

/**
 * The query is well-formed but the current search engine cannot serve it.
 *
 * Distinct from `TooManyFilterValuesError`, and distinct from a validation failure:
 * nothing about the request is malformed, it is a combination this *engine* cannot do.
 * Firestore permits one range field per query, so filtering on a price band while
 * sorting by rating needs two and cannot run.
 *
 * Naming the limitation separately matters because the set shrinks: when Typesense
 * lands (ADR-0002) these queries start working, and the errors that disappear are the
 * ones carrying this code. Folded into `VALIDATION_FAILED` they would be
 * indistinguishable from real bad input, and nobody could tell what the migration
 * fixed.
 */
export class UnsupportedQueryError extends AppError {
  readonly code = 'UNSUPPORTED_QUERY' as const;
  /** What would have to change for the query to be servable. */
  readonly limitation: string;

  constructor(
    params: { readonly limitation: string; readonly detail: string },
    options: AppErrorOptions = {},
  ) {
    super(params.detail, {
      ...options,
      context: { limitation: params.limitation, ...options.context },
    });
    this.limitation = params.limitation;
  }
}

// --- 401 / 403 / 404 --------------------------------------------------------

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED' as const;

  constructor(options: AppErrorOptions = {}) {
    super(options.detail ?? 'Sign in to continue.', options);
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN' as const;

  constructor(options: AppErrorOptions = {}) {
    super(options.detail ?? 'You do not have permission to do that.', options);
  }
}

/**
 * Also the correct error for a resource the caller does not own.
 *
 * A 403 would confirm the resource exists, which discloses information about
 * another customer's data. `NotFoundError.forHiddenResource` exists to make that
 * choice explicit and greppable at call sites, rather than looking like a mistake.
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;

  constructor(options: AppErrorOptions = {}) {
    super(options.detail ?? 'Not found.', options);
  }

  /** The caller is authenticated but does not own this resource. Deliberately a 404. */
  static forHiddenResource(
    resource: string,
    context?: Readonly<Record<string, unknown>>,
  ): NotFoundError {
    return new NotFoundError({
      detail: 'Not found.',
      context: { resource, reason: 'not_owned_by_caller', ...context },
    });
  }
}

// --- 409 --------------------------------------------------------------------

export class IdentifierTakenError extends AppError {
  readonly code = 'IDENTIFIER_TAKEN' as const;

  constructor(options: AppErrorOptions = {}) {
    // Deliberately does not echo the identifier: registration responses must not
    // become an account-enumeration oracle.
    super(options.detail ?? 'That email or mobile number is already registered.', options);
  }
}

export class InsufficientStockError extends AppError {
  readonly code = 'INSUFFICIENT_STOCK' as const;
  readonly requested: number;
  readonly available: number;

  constructor(
    params: { readonly sku: string; readonly requested: number; readonly available: number },
    options: AppErrorOptions = {},
  ) {
    super(
      options.detail ??
        `Only ${String(params.available)} unit${params.available === 1 ? '' : 's'} of ${params.sku} remain.`,
      { ...options, context: { ...options.context, sku: params.sku } },
    );
    this.requested = params.requested;
    this.available = params.available;
  }

  /** Field-level issues so the client can mark the offending cart line. */
  toIssues(lineIndex: number): readonly ValidationIssue[] {
    return [
      {
        path: `items.${String(lineIndex)}.qty`,
        message: `Requested ${String(this.requested)}, available ${String(this.available)}`,
      },
    ];
  }
}

export class ReservationExpiredError extends AppError {
  readonly code = 'RESERVATION_EXPIRED' as const;

  constructor(options: AppErrorOptions = {}) {
    super(options.detail ?? 'This order’s stock hold has expired. Please place it again.', options);
  }
}

export class DuplicatePaymentReferenceError extends AppError {
  readonly code = 'DUPLICATE_PAYMENT_REFERENCE' as const;

  constructor(options: AppErrorOptions = {}) {
    // The detail deliberately does not say *which* order claimed it — that would
    // disclose another customer's order.
    super(
      options.detail ??
        'That payment reference has already been used. Check the reference and try again.',
      options,
    );
  }
}

export class InvalidStateTransitionError extends AppError {
  readonly code = 'INVALID_STATE_TRANSITION' as const;

  constructor(options: AppErrorOptions = {}) {
    super(options.detail ?? 'That change is not allowed from the current state.', options);
  }
}

export class VariantInUseError extends AppError {
  readonly code = 'VARIANT_IN_USE' as const;

  constructor(options: AppErrorOptions = {}) {
    super(options.detail ?? 'That variant is referenced by an open order.', options);
  }
}

export class RefundExceedsRefundableError extends AppError {
  readonly code = 'REFUND_EXCEEDS_REFUNDABLE' as const;

  constructor(
    params: { readonly requestedMinor: number; readonly refundableMinor: number },
    options: AppErrorOptions = {},
  ) {
    super(options.detail ?? 'That refund is more than the remaining refundable amount.', {
      ...options,
      context: { ...options.context, ...params },
    });
  }
}

export class PaymentAmountMismatchError extends AppError {
  readonly code = 'PAYMENT_AMOUNT_MISMATCH' as const;
  readonly expectedMinor: number;
  readonly paidMinor: number;

  constructor(
    params: { readonly expectedMinor: number; readonly paidMinor: number },
    options: AppErrorOptions = {},
  ) {
    // The two figures are shown to the admin so they act on the real difference — a short
    // payment is never accepted as "close enough". Both are the customer's own order
    // amounts, so exposing them discloses nothing about anyone else.
    super(
      options.detail ??
        `The paid amount does not match the order total (expected ${String(params.expectedMinor)}, got ${String(params.paidMinor)}).`,
      { ...options, context: { ...options.context, ...params } },
    );
    this.expectedMinor = params.expectedMinor;
    this.paidMinor = params.paidMinor;
  }
}

// --- 422 / 429 / 500 --------------------------------------------------------

export class WeakPasswordError extends AppError {
  readonly code = 'WEAK_PASSWORD' as const;
  readonly suggestions: readonly string[];

  constructor(
    params: { readonly detail?: string; readonly suggestions?: readonly string[] } = {},
    options: AppErrorOptions = {},
  ) {
    super(
      params.detail ??
        'Choose a longer or less predictable password — at least 10 characters, and not a common phrase.',
      options,
    );
    this.suggestions = params.suggestions ?? [];
  }
}

export class RateLimitedError extends AppError {
  readonly code = 'RATE_LIMITED' as const;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, options: AppErrorOptions = {}) {
    super(options.detail ?? 'Too many requests. Please wait and try again.', options);
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

/**
 * An unexpected failure.
 *
 * The message and cause are for logs. `toProblemDetails` will not put them in a
 * response, because `INTERNAL` is the one code whose detail is not exposable.
 */
export class InternalError extends AppError {
  readonly code = 'INTERNAL' as const;

  constructor(message = 'Unexpected error', options: AppErrorOptions = {}) {
    super(message, options);
  }
}

// --- helpers ----------------------------------------------------------------

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Normalises anything thrown into an `AppError`.
 *
 * Everything unrecognised becomes `InternalError` with the original attached as
 * `cause`, so the detail survives for logging while the response stays bare.
 */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;

  if (value instanceof Error) {
    return new InternalError(value.message, { cause: value });
  }

  return new InternalError('Unexpected non-error value thrown', {
    context: { thrown: typeof value },
    cause: value,
  });
}

/**
 * Renders an `AppError` as an RFC 7807 problem document.
 *
 * The `isDetailExposable` check is the boundary that keeps internals out of
 * responses. It is driven by the catalogue rather than by a flag on the instance,
 * so a new error type cannot accidentally opt itself into exposing internals.
 */
export function toProblemDetails(error: AppError, requestId?: string): ProblemDetails {
  const exposeDetail = isDetailExposable(error.code);

  return {
    type: errorTypeUri(error.code),
    title: error.title,
    status: error.httpStatus,
    code: error.code,
    ...(exposeDetail && error.detail !== undefined ? { detail: error.detail } : {}),
    ...(requestId === undefined ? {} : { requestId }),
    ...(error instanceof ValidationFailedError && error.issues.length > 0
      ? { errors: [...error.issues] }
      : {}),
    ...(error instanceof RateLimitedError ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
  };
}

/**
 * Applies a state-machine transition or throws.
 *
 * This lives here rather than in `@romp/contracts` because throwing requires the
 * error taxonomy, and the dependency points one way: observability knows about
 * contracts, never the reverse. The machine itself only reports whether the table
 * permits a transition; whether *this caller* may make it is a separate question,
 * answered by the handler.
 */
export function assertTransition<TState extends string>(
  machine: StateMachine<TState>,
  from: string,
  to: string,
  context?: Readonly<Record<string, unknown>>,
): void {
  const result = machine.check(from, to);
  if (result.ok) return;

  throw new InvalidStateTransitionError({
    detail: describeTransitionFailure(machine.name, result),
    context: { machine: machine.name, from, to, reason: result.reason, ...context },
  });
}
