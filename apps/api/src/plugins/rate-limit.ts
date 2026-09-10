import type { FastifyRequest } from 'fastify';

import { RateLimitedError } from '@romp/observability';

/**
 * An in-process rate limiter.
 *
 * `API.md` applies limits at Cloudflare *and* in-process, because the app-level limit must
 * hold even if a request bypasses the edge. This is the in-process half: a fixed-window
 * counter per key, cheap and stateless beyond a `Map`.
 *
 * In-process means per-instance, which is the honest bound for a Cloud Functions
 * deployment — each instance limits its own traffic, and the edge limit is the global one.
 * A cross-instance limit would need a shared store (Firestore or Redis) on the hot path of
 * every request; that is a deliberate non-goal for v1.0, where the edge carries the global
 * ceiling and this stops a single instance being hammered.
 */

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** Requests allowed per window. */
  readonly limit: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
}

/**
 * Creates a limiter with its own counter map.
 *
 * One limiter instance per app, so a test gets a fresh one and cases do not bleed counts
 * into each other. `now` is injectable for the same reason the sweeper's clock is: a
 * window-expiry test cannot wait a real hour.
 */
export function createRateLimiter(now: () => number = Date.now) {
  const windows = new Map<string, Window>();

  /**
   * Consumes one unit for `key` under `rule`, throwing `RateLimitedError` when the window is
   * exhausted. The error carries the seconds until reset, which the error handler turns into
   * a `Retry-After` header.
   */
  function consume(key: string, rule: RateLimitRule): void {
    const current = now();
    const existing = windows.get(key);

    if (existing === undefined || existing.resetAt <= current) {
      windows.set(key, { count: 1, resetAt: current + rule.windowSeconds * 1_000 });
      return;
    }

    if (existing.count >= rule.limit) {
      const retryAfterSeconds = Math.ceil((existing.resetAt - current) / 1_000);
      throw new RateLimitedError(retryAfterSeconds);
    }

    existing.count += 1;
  }

  /** Drops expired windows. Called opportunistically so the map does not grow unbounded. */
  function sweep(): void {
    const current = now();
    for (const [key, window] of windows) {
      if (window.resetAt <= current) windows.delete(key);
    }
  }

  return { consume, sweep };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/**
 * The rate-limit key for a request: the caller's uid when signed in, else the client IP.
 *
 * A signed-in user is limited as themselves across IPs; an anonymous request is limited by
 * IP. `request.ip` is the real client address because the app trusts the proxy — on Cloud
 * Functions behind Cloudflare, the raw socket address would be the proxy's.
 */
export function rateLimitKey(request: FastifyRequest, scope: string): string {
  const subject =
    request.caller.kind === 'customer' || request.caller.kind === 'operator'
      ? `uid:${request.caller.uid}`
      : `ip:${request.ip}`;
  return `${scope}:${subject}`;
}

/**
 * Named limits from `API.md`. A route picks one by name, so the ceilings live in one table
 * rather than being sprinkled across handlers.
 */
export const RATE_LIMITS = {
  register: { limit: 5, windowSeconds: 3_600 },
  checkIdentifier: { limit: 20, windowSeconds: 3_600 },
  placeOrder: { limit: 10, windowSeconds: 3_600 },
  paymentProof: { limit: 10, windowSeconds: 3_600 },
  review: { limit: 5, windowSeconds: 86_400 },
  passwordReset: { limit: 10, windowSeconds: 3_600 },
  // Backoffice catalogue writes: generous, since a staff member editing a catalogue
  // legitimately makes many calls in a session, but still bounded so a runaway script or a
  // compromised staff token cannot hammer the write path.
  adminCatalogueWrite: { limit: 240, windowSeconds: 60 },
  // Cart writes: a shopper adds, adjusts and removes lines freely, so the ceiling is generous,
  // but bounded so a script cannot hammer the availability-checking write path.
  cartWrite: { limit: 120, windowSeconds: 60 },
  default: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;
