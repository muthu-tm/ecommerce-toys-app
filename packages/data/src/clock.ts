import type { Instant } from '@romp/contracts';

/**
 * The clock, as an injectable seam.
 *
 * Every document carries timestamps, and every one of them is either an assertion a
 * test needs to make or a value the seed needs to be deterministic about. Reading
 * `new Date()` inline makes both impossible: a seed becomes unrepeatable, and a test
 * asserting `expiresAt === createdAt + 30 minutes` has to compare against a moving
 * target with a tolerance, which is how a flaky test enters a suite.
 *
 * This is also why writes resolve server time here rather than passing
 * `FieldValue.serverTimestamp()`. The sentinel cannot be validated by a schema, and —
 * more usefully — the code that wrote the document cannot know what value it wrote,
 * so it cannot return it to the caller or derive an expiry from it. The trade is
 * accepted: an instant from the writing process rather than from Firestore's servers.
 * For a reservation TTL and an audit timestamp, a few milliseconds of clock skew
 * between Cloud Functions instances does not change any decision the platform makes.
 * The one place it would matter — sequence numbers — uses a transactional counter
 * instead of a timestamp.
 */
export interface Clock {
  now: () => Instant;
}

/** The real clock. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * A clock frozen at one instant.
 *
 * Used by the seed so a re-run writes byte-identical documents, and by tests so a
 * timestamp is an equality assertion rather than a range check.
 */
export function fixedClock(instant: Instant): Clock {
  return { now: () => new Date(instant.getTime()) };
}

/**
 * Adds whole minutes to an instant.
 *
 * A named helper because reservation expiry is computed from
 * `settings.checkout.reservationTtlMinutes` in more than one place, and
 * `new Date(now.getTime() + ttl * 60_000)` written twice is two chances to write
 * `60_00`.
 */
export function addMinutes(instant: Instant, minutes: number): Instant {
  if (!Number.isFinite(minutes)) {
    throw new TypeError(`Cannot add ${String(minutes)} minutes to an instant.`);
  }
  return new Date(instant.getTime() + minutes * 60_000);
}
