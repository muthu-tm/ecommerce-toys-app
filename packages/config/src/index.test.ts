import { describe, expect, it } from 'vitest';

import {
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  COVERAGE_TIERS,
  DEFAULT_TEST_ENVIRONMENT,
  NODE_VERSION,
  coverageFor,
  type CoverageTier,
} from './index';

describe('toolchain policy', () => {
  it('pins a Node version matching the .nvmrc format', () => {
    expect(NODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('defaults tests to the node environment', () => {
    expect(DEFAULT_TEST_ENVIRONMENT).toBe('node');
  });
});

describe('coverageFor', () => {
  it('returns thresholds for every declared tier', () => {
    for (const tier of COVERAGE_TIERS) {
      const thresholds = coverageFor(tier);
      expect(thresholds.lines).toBeGreaterThan(0);
      expect(thresholds.functions).toBeGreaterThan(0);
      expect(thresholds.branches).toBeGreaterThan(0);
      expect(thresholds.statements).toBeGreaterThan(0);
    }
  });

  it('holds every threshold at or below 100 percent', () => {
    for (const tier of COVERAGE_TIERS) {
      const thresholds = coverageFor(tier);
      for (const value of Object.values(thresholds)) {
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('orders tiers strictest first, so domain logic is held to the highest bar', () => {
    const lineFloors = COVERAGE_TIERS.map((tier) => coverageFor(tier).lines);
    const sortedDescending = [...lineFloors].sort((a, b) => b - a);
    expect(lineFloors).toEqual(sortedDescending);
  });

  it('holds pure domain logic to a higher bar than UI', () => {
    expect(coverageFor('domain').lines).toBeGreaterThan(coverageFor('ui').lines);
    expect(coverageFor('domain').branches).toBeGreaterThan(coverageFor('ui').branches);
  });

  it('returns frozen thresholds so a package cannot lower the floor at runtime', () => {
    const thresholds = coverageFor('domain');
    expect(Object.isFrozen(thresholds)).toBe(true);
    expect(() => {
      // @ts-expect-error — deliberately probing immutability of a readonly field.
      thresholds.lines = 1;
    }).toThrow(TypeError);
  });

  it('rejects an unknown tier at compile time', () => {
    // @ts-expect-error — 'nonsense' is not a CoverageTier.
    const tier: CoverageTier = 'nonsense';
    expect(tier).toBe('nonsense');
  });
});

describe('coverage denominator', () => {
  it('excludes generated and test-only paths', () => {
    expect(COVERAGE_EXCLUDE).toContain('**/generated/**');
    expect(COVERAGE_EXCLUDE).toContain('**/*.test.{ts,tsx}');
    expect(COVERAGE_EXCLUDE).toContain('**/__fixtures__/**');
  });

  it('does not blanket-exclude barrel files, which would exempt real code', () => {
    expect(COVERAGE_EXCLUDE).not.toContain('**/index.ts');
    expect(COVERAGE_EXCLUDE).not.toContain('**/index.tsx');
  });

  it('measures only shipped source', () => {
    expect(COVERAGE_INCLUDE).toEqual(['src/**/*.{ts,tsx}']);
  });

  it('is frozen so packages share one policy', () => {
    expect(Object.isFrozen(COVERAGE_EXCLUDE)).toBe(true);
    expect(Object.isFrozen(COVERAGE_INCLUDE)).toBe(true);
  });
});
