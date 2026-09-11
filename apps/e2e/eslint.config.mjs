import { baseConfig } from '@romp/config/eslint';

/**
 * ESLint for the E2E suite.
 *
 * The base config already relaxes `no-console` and `import/no-default-export` for
 * `*.config.ts` and spec files. Playwright's `global-setup.ts` is a default-exported module
 * Playwright loads by path — the same shape as a config file — so it is added to the
 * default-export allow-list here. Specs may log freely; they are diagnostics, not shipped code.
 */
export default [
  ...baseConfig,
  {
    files: ['global-setup.ts', 'tests/**/*.ts', 'fixtures/**/*.ts'],
    rules: {
      'import/no-default-export': 'off',
      'no-console': 'off',
    },
  },
];
