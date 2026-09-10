import { createVitestConfig } from './vitest/base.mjs';

/**
 * The default denominator is `src/**`, but this package's substance lives in two
 * files outside it: `policy.mjs` holds the coverage thresholds themselves, and
 * `vitest/base.mjs` is the preset every other package's gate is built from.
 * Leaving them unmeasured would mean the file that defines the coverage contract
 * is the one file exempt from it.
 */
export default createVitestConfig({
  tier: 'domain',
  coverageInclude: ['src/**/*.ts', 'policy.mjs', 'vitest/base.mjs'],
});
