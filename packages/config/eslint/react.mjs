// @ts-check
/**
 * ESLint flat config for the React / Next.js surfaces (storefront, admin, ui).
 *
 * Consume it from a package's `eslint.config.mjs`:
 *
 *   import { reactConfig } from '@romp/config/eslint/react';
 *   export default [...reactConfig];
 *
 * For app surfaces, prefer `@romp/config/eslint/app`, which layers the
 * `no-hardcoded-brand` rule on top of this and so enforces the white-label contract.
 * This config on its own does not.
 */
import globals from 'globals';

import { baseConfig } from './base.mjs';

export const reactConfig = [
  ...baseConfig,
  {
    files: ['**/*.tsx', '**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Next.js pages, layouts, route handlers and metadata all require default exports.
      'import/no-default-export': 'off',
    },
  },
  {
    // App Router convention files are default-export by design.
    files: [
      '**/app/**/page.tsx',
      '**/app/**/layout.tsx',
      '**/app/**/template.tsx',
      '**/app/**/error.tsx',
      '**/app/**/loading.tsx',
      '**/app/**/not-found.tsx',
      '**/app/**/route.ts',
      '**/next.config.*',
      '**/tailwind.config.*',
    ],
    rules: {
      'import/no-default-export': 'off',
      'no-restricted-globals': 'off',
    },
  },
];
