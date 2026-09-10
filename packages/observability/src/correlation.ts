import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Request-scoped context, carried implicitly.
 *
 * Every log line and every error response needs the correlation ID, and threading it
 * through every function signature down to the repository layer would be noise that
 * gets dropped the first time someone adds a helper. `AsyncLocalStorage` makes it
 * ambient for the duration of a request without making it a global.
 *
 * Note what is *not* here: the caller's identity as an authorisation input.
 * `uid` is recorded for log attribution only. Ownership checks take the caller as an
 * explicit parameter, because an authorisation decision read from ambient state is
 * one nobody can see at the call site.
 */

export interface RequestContext {
  /** Correlation ID, echoed as `x-request-id`. */
  readonly requestId: string;
  /** For log attribution only — never for authorisation. */
  readonly uid?: string;
  readonly route?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<TResult>(
  context: RequestContext,
  callback: () => TResult,
): TResult {
  return storage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Accepts an inbound correlation ID or mints one.
 *
 * Inbound values are length-capped and stripped of anything outside a safe set: the
 * value is echoed into a response header and into log lines, so an unbounded or
 * newline-bearing value from a client is a header-injection and log-forging vector.
 */
export function resolveRequestId(inbound?: string | string[] | null): string {
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  if (candidate === undefined || candidate === null) return randomUUID();

  const sanitised = candidate.replaceAll(/[^\w.:-]/gu, '').slice(0, 128);
  return sanitised.length === 0 ? randomUUID() : sanitised;
}
