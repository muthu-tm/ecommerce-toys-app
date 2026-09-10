// @ts-check
/**
 * Shared ESLint flat config for every TypeScript package in the ROMP platform.
 *
 * Consume it from a package's `eslint.config.mjs`:
 *
 *   import { baseConfig } from '@romp/config/eslint';
 *   export default [...baseConfig];
 *
 * Type-aware rules are enabled for `.ts`/`.tsx` only. Each consuming package must
 * therefore have a `tsconfig.json` that includes the files being linted.
 */
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Paths that never get linted, in every package. */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  // `lib/**`, not `**/lib/**`. The intent is a package's compiled-output directory, and
  // the recursive form silently swallowed `apps/*/src/lib/` too — a directory Next.js
  // apps put real source in. That went unnoticed because an ignored file produces no
  // errors, which is indistinguishable from a clean one. ESLint resolves these relative
  // to the config file, and lint runs per package, so the narrow form still covers
  // every package's own build output.
  'lib/**',
  '**/.next/**',
  '**/out/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/generated/**',
  '**/*.d.ts',
];

export const baseConfig = tseslint.config(
  { ignores },

  // ---------------------------------------------------------------- JS baseline
  eslint.configs.recommended,

  // ------------------------------------------- TypeScript sources, type-aware
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
        node: true,
      },
    },
    rules: {
      // --- Correctness that matters in a payments codebase -----------------
      // An unawaited write is a silently lost order. Never allow one.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      // Exhaustiveness over state machines (order status, fulfilment status).
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': ['error', { props: true }],

      // --- Explicitness ----------------------------------------------------
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Allow `void promise` as a deliberate fire-and-forget marker.
      'no-void': ['error', { allowAsStatement: true }],

      // --- Structured logging is mandatory; bare console is not ------------
      'no-console': 'error',

      // --- Import hygiene --------------------------------------------------
      'import/order': [
        'error',
        {
          // `type` is deliberately absent: separate type-imports should sort
          // beside the value imports they accompany, not collect in a trailing
          // block. `consistent-type-imports` already keeps them separate.
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object'],
          pathGroups: [{ pattern: '@romp/**', group: 'internal', position: 'before' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
      'import/no-default-export': 'error',
    },
  },

  // ------------------------------------------------- Plain JS / config files
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      'import/no-default-export': 'off',
      'no-console': 'off',
    },
  },

  // --------------------------------------------------------- Test relaxations
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/test/**',
      '**/__tests__/**',
      '**/__fixtures__/**',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },

  // ---------------------------- Scripts and config files may use the console
  {
    files: [
      '**/scripts/**',
      '**/*.config.ts',
      '**/*.config.mts',
      '**/seed/**',
      '**/vitest/**',
      '**/eslint/**',
    ],
    rules: {
      'no-console': 'off',
      'import/no-default-export': 'off',
    },
  },

  // ----------------------------------------------- Store definition files
  //
  // A store is declared as a default-exported data literal, because that is what
  // the loader dynamically imports — it has one file path and no name to import
  // by. `store.config.ts` already slips through the `*.config.ts` pattern above;
  // its siblings need saying explicitly rather than relying on that coincidence.
  {
    // Unanchored, because ESLint resolves these against the directory it was
    // invoked from — and it is invoked per package, so inside `stores/romp/` the
    // file is simply `store.config.ts`.
    files: ['**/store.config.ts', '**/seed.catalogue.ts'],
    rules: {
      'import/no-default-export': 'off',
    },
  },

  // Prettier last — it only turns formatting rules off.
  prettierConfig,
);
