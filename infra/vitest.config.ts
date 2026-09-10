import { createVitestConfig } from '@romp/config/vitest';

/**
 * This package ships `.rules` files and index definitions, not JavaScript, so a
 * line-coverage gate would measure nothing. Correctness is asserted
 * behaviourally against the emulator instead — see `coverage: false` in the
 * preset for the reasoning.
 *
 * Timeouts are generous because the first Firestore round trip after the
 * emulator boots is slow, and a flaky timeout in the security suite would be
 * the fastest way to get that suite disabled.
 */
export default createVitestConfig({
  coverage: false,
  include: ['tests/**/*.test.ts'],
  testTimeout: 30_000,
  hookTimeout: 60_000,
  // Every suite in here talks to the same Firestore emulator instance, and each
  // rules suite clears the database between tests to keep its fixtures
  // predictable. Run in parallel, one file's `clearFirestore()` deletes the
  // documents another file is midway through asserting on — a failure that only
  // appears when the files run together, which is exactly the kind of flake that
  // gets a suite retried instead of fixed.
  fileParallelism: false,
});
