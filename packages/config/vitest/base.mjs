import { defineConfig } from 'vitest/config';

import {
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  DEFAULT_TEST_ENVIRONMENT,
  THRESHOLDS,
} from '../policy.mjs';

/**
 * @typedef {'domain' | 'standard' | 'ui'} CoverageTier
 *
 * @typedef {object} VitestPresetOptions
 * @property {CoverageTier} [tier]
 *   Coverage tier for this package, determining the enforced threshold floor.
 *   Required unless `coverage: false` is set.
 * @property {false} [coverage]
 *   Opt out of coverage entirely. Only for packages that ship no measurable
 *   JavaScript — `@romp/infra` is the motivating case, since its artefacts are
 *   `.rules` files and index definitions exercised through the Firebase
 *   emulator. A V8 line-coverage gate over an empty `src/` would report 100% of
 *   nothing, which is worse than no gate because it looks like one. Correctness
 *   for those packages is asserted behaviourally — an allow case and a deny case
 *   per rule — not by counting lines.
 * @property {'node' | 'jsdom'} [environment] Test environment. `jsdom` for React packages.
 * @property {readonly string[]} [setupFiles] Extra setup files, run before each test file.
 * @property {readonly string[]} [include] Test file globs, replacing the default.
 * @property {readonly string[]} [coverageExclude] Additional exclusions on top of the shared list.
 * @property {readonly string[]} [coverageInclude] Override the coverage denominator.
 * @property {number} [testTimeout]
 *   Per-test timeout in milliseconds. Raise it for emulator-backed suites, where
 *   a cold Firestore transaction is slow relative to a unit test.
 * @property {number} [hookTimeout] Per-hook timeout in milliseconds.
 * @property {false} [fileParallelism]
 *   Run test files one at a time instead of in parallel.
 *
 *   Set this for any suite backed by a shared external service. `@romp/infra` is the
 *   motivating case: every rules suite talks to one Firestore emulator instance, and
 *   `clearFirestore()` in one file's `beforeEach` deletes the fixtures another file is
 *   halfway through asserting on. The symptom is a test that fails only when run
 *   alongside its neighbours, which is the kind of flake that gets a suite retried
 *   until it passes rather than fixed.
 */

/**
 * Builds a Vitest config from the shared preset.
 *
 * Consume it from a package's `vitest.config.ts`:
 *
 *     import { createVitestConfig } from '@romp/config/vitest';
 *     export default createVitestConfig({ tier: 'domain' });
 *
 * @param {VitestPresetOptions} options
 * @returns {import('vitest/config').ViteUserConfig}
 */
export function createVitestConfig(options) {
  const {
    tier,
    coverage,
    environment = DEFAULT_TEST_ENVIRONMENT,
    setupFiles = [],
    include = ['src/**/*.{test,spec}.{ts,tsx}'],
    coverageExclude = [],
    coverageInclude = COVERAGE_INCLUDE,
    testTimeout = 10_000,
    hookTimeout = 20_000,
    fileParallelism,
  } = options;

  // Fail at config load rather than silently skipping the gate. A package that
  // forgets its tier would otherwise run with no coverage enforcement at all.
  if (tier === undefined && coverage !== false) {
    throw new Error(
      'createVitestConfig: pass a coverage `tier`, or `coverage: false` for packages that ship no measurable JavaScript.',
    );
  }
  if (tier !== undefined && coverage === false) {
    throw new Error(
      'createVitestConfig: `tier` and `coverage: false` are mutually exclusive — a tier declares a gate, `coverage: false` declines one.',
    );
  }

  return defineConfig({
    test: {
      environment,
      globals: false,
      include: [...include],
      setupFiles: [...setupFiles],
      restoreMocks: true,
      clearMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      // Fail the run rather than hang if a test leaks a timer or open handle.
      testTimeout,
      hookTimeout,
      ...(fileParallelism === false ? { fileParallelism: false } : {}),
      ...(tier === undefined
        ? {}
        : {
            coverage: {
              provider: /** @type {const} */ ('v8'),
              reporter: ['text-summary', 'lcov', 'json-summary'],
              reportsDirectory: 'coverage',
              include: [...coverageInclude],
              exclude: [...COVERAGE_EXCLUDE, ...coverageExclude],
              thresholds: THRESHOLDS[tier],
              // `include` is the denominator: every matching file is measured
              // whether or not a test imports it. So a package with untested
              // source fails the gate instead of reporting 100% of the subset
              // that happens to be covered. (Vitest 4 removed the old `all`
              // flag and made this the behaviour of `include`.)
            },
          }),
    },
  });
}
