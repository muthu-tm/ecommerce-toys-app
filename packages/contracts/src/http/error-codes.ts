import { z } from 'zod';

/**
 * The error catalogue.
 *
 * `code` is the stable, machine-readable contract. Clients branch on `code`, never
 * on `detail`, which is human-facing and may be reworded at any time. That split is
 * why both live in the response: one for software, one for people.
 */
export const ErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'FILTER_LIMIT_EXCEEDED',
  'UNSUPPORTED_QUERY',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'IDENTIFIER_TAKEN',
  'INSUFFICIENT_STOCK',
  'RESERVATION_EXPIRED',
  'DUPLICATE_PAYMENT_REFERENCE',
  'INVALID_STATE_TRANSITION',
  'VARIANT_IN_USE',
  'REFUND_EXCEEDS_REFUNDABLE',
  'WEAK_PASSWORD',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

interface ErrorDefinition {
  readonly status: number;
  /** Short, stable, human-readable summary. Safe to show a customer. */
  readonly title: string;
  /** URI reference identifying the error class, per RFC 7807 `type`. */
  readonly slug: string;
  /**
   * Whether a handler-supplied `detail` may be shown to the caller.
   *
   * `false` for `INTERNAL` only, and that single flag is the control that keeps
   * stack traces, Firestore messages and internal IDs out of client responses.
   */
  readonly exposeDetail: boolean;
}

export const ERROR_DEFINITIONS: Readonly<Record<ErrorCode, ErrorDefinition>> = Object.freeze({
  VALIDATION_FAILED: {
    status: 400,
    title: 'Validation failed',
    slug: 'validation-failed',
    exposeDetail: true,
  },
  // Both of the following are 400s rather than 500s, deliberately. The caller asked
  // for something the datastore cannot serve, and the fix is to ask differently — so
  // the response has to say which filter and what the ceiling is. Returning results
  // for the first ten of eleven values instead would be a wrong-results bug nobody
  // reports, because nobody can see it.
  FILTER_LIMIT_EXCEEDED: {
    status: 400,
    title: 'Too many filter values',
    slug: 'filter-limit-exceeded',
    exposeDetail: true,
  },
  UNSUPPORTED_QUERY: {
    status: 400,
    title: 'Unsupported query',
    slug: 'unsupported-query',
    exposeDetail: true,
  },
  UNAUTHENTICATED: {
    status: 401,
    title: 'Authentication required',
    slug: 'unauthenticated',
    exposeDetail: true,
  },
  FORBIDDEN: {
    status: 403,
    title: 'Not permitted',
    slug: 'forbidden',
    exposeDetail: true,
  },
  // Also returned for resources the caller does not own. A 403 would confirm the
  // resource exists, which is itself a disclosure about another customer's data.
  NOT_FOUND: {
    status: 404,
    title: 'Not found',
    slug: 'not-found',
    exposeDetail: true,
  },
  IDENTIFIER_TAKEN: {
    status: 409,
    title: 'Identifier already registered',
    slug: 'identifier-taken',
    exposeDetail: true,
  },
  INSUFFICIENT_STOCK: {
    status: 409,
    title: 'Insufficient stock',
    slug: 'insufficient-stock',
    exposeDetail: true,
  },
  RESERVATION_EXPIRED: {
    status: 409,
    title: 'Reservation expired',
    slug: 'reservation-expired',
    exposeDetail: true,
  },
  DUPLICATE_PAYMENT_REFERENCE: {
    status: 409,
    title: 'Payment reference already used',
    slug: 'duplicate-payment-reference',
    exposeDetail: true,
  },
  INVALID_STATE_TRANSITION: {
    status: 409,
    title: 'Invalid state transition',
    slug: 'invalid-state-transition',
    exposeDetail: true,
  },
  VARIANT_IN_USE: {
    status: 409,
    title: 'Variant in use',
    slug: 'variant-in-use',
    exposeDetail: true,
  },
  REFUND_EXCEEDS_REFUNDABLE: {
    status: 409,
    title: 'Refund exceeds refundable amount',
    slug: 'refund-exceeds-refundable',
    exposeDetail: true,
  },
  WEAK_PASSWORD: {
    status: 422,
    title: 'Password too weak',
    slug: 'weak-password',
    exposeDetail: true,
  },
  RATE_LIMITED: {
    status: 429,
    title: 'Too many requests',
    slug: 'rate-limited',
    exposeDetail: true,
  },
  INTERNAL: {
    status: 500,
    title: 'Internal server error',
    slug: 'internal',
    exposeDetail: false,
  },
});

/** Base URI for error `type` references. */
export const ERROR_TYPE_BASE_URI = 'https://romp.dev/errors';

export function errorTypeUri(code: ErrorCode): string {
  return `${ERROR_TYPE_BASE_URI}/${ERROR_DEFINITIONS[code].slug}`;
}

export function httpStatusForErrorCode(code: ErrorCode): number {
  return ERROR_DEFINITIONS[code].status;
}

export function errorTitle(code: ErrorCode): string {
  return ERROR_DEFINITIONS[code].title;
}

export function isDetailExposable(code: ErrorCode): boolean {
  return ERROR_DEFINITIONS[code].exposeDetail;
}
