/**
 * `@romp/observability` — structured logging, the error taxonomy, and the mapping
 * from a thrown error to an HTTP response.
 *
 * Two invariants this package exists to hold:
 *
 *  1. **No PII in logs.** Redaction runs at serialisation time on the whole log
 *     object, so a careless `logger.info({ user })` cannot leak a phone number or
 *     email at any nesting depth.
 *  2. **No internals in responses.** `toProblemDetails` decides exposure from the
 *     error catalogue, not from a flag on the instance, so an unexpected failure is
 *     always a bare 500 carrying only the correlation ID.
 *
 * It depends on `@romp/contracts` for error codes and the problem shape. The
 * dependency points one way — contracts never imports this — which is why the
 * state machines there report transition failures instead of throwing.
 */

export {
  DEFAULT_MAX_ARRAY_LENGTH,
  DEFAULT_MAX_DEPTH,
  DEFAULT_REDACTED_KEYS,
  REDACTED,
  createRedactor,
  redact,
} from './redact';
export type { RedactOptions } from './redact';

export {
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
export type { AppErrorOptions } from './errors';

export { parseOrThrow, validationErrorFromZod, zodIssuesToValidationIssues } from './zod-problem';

export {
  getRequestContext,
  getRequestId,
  resolveRequestId,
  runWithRequestContext,
} from './correlation';
export type { RequestContext } from './correlation';

export { createLogger, createSilentLogger } from './logger';
export type { AppLogger, LogLevel, LoggerOptions } from './logger';

export {
  createLoggingReporter,
  createNoopReporter,
  isReportable,
  reportIfUnexpected,
} from './reporter';
export type { ErrorReportContext, ErrorReporter } from './reporter';
