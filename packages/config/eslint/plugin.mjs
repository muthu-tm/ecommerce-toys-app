import { noHardcodedBrand } from './rules/no-hardcoded-brand.mjs';

/**
 * The local ESLint plugin.
 *
 * One rule so far. It lives here rather than in `@romp/store-config` because a lint
 * plugin has to be loadable by a flat config file, which Node resolves natively — and
 * `@romp/store-config` is TypeScript.
 *
 * @type {import('eslint').ESLint.Plugin}
 */
export const rompPlugin = {
  meta: { name: '@romp/eslint-plugin', version: '0.1.0' },
  rules: {
    'no-hardcoded-brand': noHardcodedBrand,
  },
};

export default rompPlugin;
