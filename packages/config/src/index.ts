/**
 * Shared, testable policy constants for the ROMP monorepo toolchain.
 *
 * The values live in `../policy.mjs`, which must be plain JavaScript because
 * each package's `vitest.config.ts` reaches the shared preset across a package
 * boundary, where Node loads the file natively instead of letting Vite bundle
 * it — and Node 20, our floor, cannot load TypeScript.
 *
 * This module is the typed, documented API over that data: it gives the values
 * names and types, and it is what carries the coverage gate. The split exists so
 * the numbers are stated exactly once.
 */

import {
  COVERAGE_EXCLUDE as EXCLUDE,
  COVERAGE_INCLUDE as INCLUDE,
  COVERAGE_TIERS as TIERS,
  DEFAULT_TEST_ENVIRONMENT as TEST_ENVIRONMENT,
  NODE_VERSION as NODE,
  THRESHOLDS,
} from '../policy.mjs';

/** Node version pinned by `.nvmrc` and the root `engines` field. */
export const NODE_VERSION: string = NODE;

/** Test-runner environment name used by every package's Vitest config. */
export const DEFAULT_TEST_ENVIRONMENT: string = TEST_ENVIRONMENT;

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
 */
export type CoverageTier = 'domain' | 'standard' | 'ui';

export interface CoverageThresholds {
  readonly lines: number;
  readonly functions: number;
  readonly branches: number;
  readonly statements: number;
}

/** The declared coverage floor for a tier. */
export function coverageFor(tier: CoverageTier): CoverageThresholds {
  return THRESHOLDS[tier];
}

/** Every tier name, ordered strictest first. */
export const COVERAGE_TIERS: readonly CoverageTier[] = TIERS;

/**
 * Paths excluded from coverage in every package.
 *
 * Note what is deliberately *not* here: `index.ts`. A blanket barrel-file
 * exclusion is a common way to accidentally exempt real implementation code
 * from the coverage gate, so barrels are measured like anything else.
 */
export const COVERAGE_EXCLUDE: readonly string[] = EXCLUDE;

/**
 * Globs that define the coverage denominator. Only shipped source counts —
 * toolchain and config files are measured by whether they work, not by lines.
 */
export const COVERAGE_INCLUDE: readonly string[] = INCLUDE;
