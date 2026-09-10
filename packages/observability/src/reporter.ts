import { isAppError, toAppError } from './errors';
import type { AppLogger } from './logger';

/**
 * Error reporting, behind a port.
 *
 * Sentry is the intended implementation, but the adapters land with the surfaces
 * that need them — `@sentry/nextjs` requires Next as a peer, and `apps/*` do not
 * exist yet. Defining the port now means the call sites are written once and the
 * adapter is additive, the same pattern as `SearchPort` (ADR-0002).
 *
 * The important decision here is *what gets reported*. Expected failures — a
 * validation error, a 404, a rate limit — are not incidents; reporting them fills the
 * dashboard with noise until nobody looks at it. Only unexpected failures and
 * genuine server faults are reported. Everything is still logged.
 */

export interface ErrorReportContext {
  readonly requestId?: string;
  readonly uid?: string;
  readonly route?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface ErrorReporter {
  captureException: (error: unknown, context?: ErrorReportContext) => void;
  captureMessage: (message: string, context?: ErrorReportContext) => void;
  /** Flush pending events. Cloud Functions freeze the process on return. */
  flush: (timeoutMs?: number) => Promise<void>;
}

/** Discards everything. The default in tests and local development. */
export function createNoopReporter(): ErrorReporter {
  return {
    captureException: () => undefined,
    captureMessage: () => undefined,
    // Resolved rather than `async`: there is nothing to await, and marking it async
    // just to satisfy the signature trips the no-await lint rule for no benefit.
    flush: () => Promise.resolve(),
  };
}

/**
 * Reports through the logger.
 *
 * Useful before a Sentry adapter exists and in environments where adding one is not
 * worth it — the signal still lands in Cloud Logging, where alert policies can see
 * it.
 */
export function createLoggingReporter(logger: AppLogger): ErrorReporter {
  return {
    captureException: (error, context) => {
      logger.error({ err: toAppError(error), ...context }, 'reported exception');
    },
    captureMessage: (message, context) => {
      logger.warn({ ...context }, message);
    },
    flush: () => Promise.resolve(),
  };
}

/**
 * Whether an error is worth reporting as an incident.
 *
 * 5xx and anything unrecognised: yes. Expected 4xx outcomes: no — they are ordinary
 * traffic, and treating them as incidents is how alerting gets ignored.
 */
export function isReportable(error: unknown): boolean {
  if (!isAppError(error)) return true;
  return error.httpStatus >= 500;
}

/** Reports only what `isReportable` allows. */
export function reportIfUnexpected(
  reporter: ErrorReporter,
  error: unknown,
  context?: ErrorReportContext,
): void {
  if (isReportable(error)) {
    reporter.captureException(error, context);
  }
}
