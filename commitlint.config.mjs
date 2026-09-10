/**
 * Conventional Commits, with scopes matching the workspace layout so history
 * stays greppable per surface (e.g. `feat(api): add payment-proof endpoint`).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // apps
        'storefront',
        'admin',
        'api',
        // packages
        'contracts',
        'core',
        'data',
        'store-config',
        'ui',
        'observability',
        'config',
        // cross-cutting
        'infra',
        'docs',
        'ci',
        'deps',
        'repo',
      ],
    ],
    'body-max-line-length': [1, 'always', 120],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
  },
};
