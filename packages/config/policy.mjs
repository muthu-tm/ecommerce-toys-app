/**
 * Toolchain policy — the single source of truth for coverage tiers and the
 * coverage denominator.
 *
 * Why this file is plain ESM rather than TypeScript, and why it sits at the
 * package root:
 *
 * Each package's `vitest.config.ts` imports the shared preset through this
 * package's `exports` map. That crosses a package boundary, so Node loads the
 * file natively rather than letting Vite bundle it — and Node 20, which is our
 * floor (`.nvmrc`), cannot load TypeScript at all. Anything reachable from a
 * consumer's config file must therefore be real JavaScript.
 *
 * The typed, tested API over this data lives in `src/index.ts`. This file holds
 * the values; that file gives them names, types and a coverage gate. Keeping the
 * data here rather than duplicating it there is what stops the two from drifting.
 *
 * Types are supplied by JSDoc and verified by `checkJs` in this package's
 * `tsconfig.json`, so the annotations below are checked, not decorative.
 */

/**
 * @typedef {'domain' | 'standard' | 'ui'} CoverageTier
 * @typedef {{ lines: number, functions: number, branches: number, statements: number }} CoverageThresholds
 */

/** Node version pinned by `.nvmrc` and the root `engines` field. */
export const NODE_VERSION = '20.11.0';

/** Test-runner environment name used by every package's Vitest config. */
export const DEFAULT_TEST_ENVIRONMENT = 'node';

/**
 * Coverage tiers.
 *
 * - `domain`  — pure logic with no I/O (`@romp/core`, `@romp/contracts`). Money
 *               arithmetic, state machines and the notification routing table
 *               live here, so this tier is held to the highest bar.
 * - `standard`— packages that touch I/O behind interfaces (`@romp/data`,
 *               `@romp/api`). Emulator-backed integration tests count here.
 * - `ui`      — React surfaces, where behaviour is asserted through rendering
 *               and accessibility checks rather than line coverage.
 *
 * @type {Readonly<Record<CoverageTier, CoverageThresholds>>}
 */
export const THRESHOLDS = Object.freeze({
  domain: Object.freeze({ lines: 95, functions: 95, branches: 90, statements: 95 }),
  standard: Object.freeze({ lines: 80, functions: 80, branches: 75, statements: 80 }),
  ui: Object.freeze({ lines: 70, functions: 70, branches: 65, statements: 70 }),
});

/**
 * Every tier name, ordered strictest first.
 * @type {readonly CoverageTier[]}
 */
export const COVERAGE_TIERS = Object.freeze(['domain', 'standard', 'ui']);

/**
 * Paths excluded from coverage in every package.
 *
 * Note what is deliberately *not* here: `index.ts`. A blanket barrel-file
 * exclusion is a common way to accidentally exempt real implementation code from
 * the coverage gate, so barrels are measured like anything else.
 *
 * @type {readonly string[]}
 */
export const COVERAGE_EXCLUDE = Object.freeze([
  '**/node_modules/**',
  '**/dist/**',
  '**/lib/**',
  '**/.next/**',
  '**/coverage/**',
  '**/generated/**',
  '**/*.config.{ts,mts,js,mjs,cjs}',
  '**/*.d.ts',
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/__fixtures__/**',
  '**/scripts/**',
  // Test doubles and harnesses. They are exercised by every test that uses them, so
  // counting their lines measures nothing — and leaving them in the denominator creates
  // pressure to write tests *for the harness*, which is effort spent on the one piece of
  // code that ships to nobody.
  '**/test-support/**',
  '**/test-*.{ts,tsx}',
]);

/**
 * Globs that define the coverage denominator. Only shipped source counts —
 * toolchain and config files are measured by whether they work, not by lines.
 *
 * @type {readonly string[]}
 */
export const COVERAGE_INCLUDE = Object.freeze(['src/**/*.{ts,tsx}']);
