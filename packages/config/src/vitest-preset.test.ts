import { describe, expect, it } from 'vitest';

import { createVitestConfig } from '../vitest/base.mjs';

import { coverageFor } from './index';

/**
 * The preset decides whether a package has a coverage gate at all, so its
 * failure modes matter more than its happy path: a package that silently runs
 * with no gate is worse than one that fails to start.
 */
describe('createVitestConfig', () => {
  it('applies the tier thresholds', () => {
    const config = createVitestConfig({ tier: 'domain' });

    expect(config.test?.coverage).toMatchObject({
      provider: 'v8',
      thresholds: coverageFor('domain'),
    });
  });

  it('measures only shipped source by default', () => {
    const config = createVitestConfig({ tier: 'standard' });
    const coverage = config.test?.coverage;

    expect(coverage).toBeDefined();
    // Narrow away the union of provider-specific coverage option shapes.
    if (coverage === undefined || !('include' in coverage)) {
      throw new Error('expected coverage options with an include list');
    }
    expect(coverage.include).toEqual(['src/**/*.{ts,tsx}']);
    expect(coverage.exclude).toContain('**/scripts/**');
    // Barrel files are deliberately measured, not exempted.
    expect(coverage.exclude).not.toContain('**/index.ts');
  });

  it('omits coverage entirely when a package declines a gate', () => {
    const config = createVitestConfig({ coverage: false });

    expect(config.test?.coverage).toBeUndefined();
  });

  it('rejects a config with neither a tier nor an explicit opt-out', () => {
    expect(() => createVitestConfig({})).toThrow(/pass a coverage `tier`/);
  });

  it('rejects a tier combined with an opt-out', () => {
    expect(() => createVitestConfig({ tier: 'ui', coverage: false })).toThrow(/mutually exclusive/);
  });

  it('defaults timeouts but allows emulator suites to raise them', () => {
    expect(createVitestConfig({ tier: 'domain' }).test?.testTimeout).toBe(10_000);

    const slow = createVitestConfig({ coverage: false, testTimeout: 60_000, hookTimeout: 120_000 });
    expect(slow.test?.testTimeout).toBe(60_000);
    expect(slow.test?.hookTimeout).toBe(120_000);
  });

  it('passes through the test environment and include globs', () => {
    const config = createVitestConfig({
      coverage: false,
      environment: 'jsdom',
      include: ['tests/**/*.test.ts'],
    });

    expect(config.test?.environment).toBe('jsdom');
    expect(config.test?.include).toEqual(['tests/**/*.test.ts']);
  });
});
