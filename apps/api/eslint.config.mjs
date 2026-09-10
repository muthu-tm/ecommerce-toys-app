import { readFileSync } from 'node:fs';

import { createAppConfig } from '@romp/config/eslint/app';

/**
 * The white-label contract, enforced in the API too.
 *
 * Brand names are read from the generated store config so a hardcoded brand name in a
 * handler or a copy string is rejected in that store's build — the same rule the storefront
 * runs. The API has no `src/generated` of its own (it renders no pages), so it reads the
 * canonical artefact that `pnpm store:tokens` writes in `@romp/store-config`.
 *
 * If that file is missing, this throws rather than falling back to an empty list: a brand
 * rule with nothing to match passes silently while the brand is hardcoded everywhere, which
 * is worse than no rule because it is believed.
 */
const generatedConfigPath = new URL(
  '../../packages/store-config/generated/store-config.json',
  import.meta.url,
);
let brand;
try {
  ({ brand } = JSON.parse(readFileSync(generatedConfigPath, 'utf8')));
} catch (cause) {
  throw new Error(
    'apps/api: packages/store-config/generated/store-config.json is missing. Run `pnpm store:tokens` before linting.',
    { cause },
  );
}

export default [
  ...createAppConfig({
    brandNames: [brand.name, brand.legalName],
    files: ['src/**/*.ts'],
    // Identity has no repository to route through — the Auth Admin SDK is the datastore
    // for users, so the API is the one sanctioned place to hold it. Firestore access still
    // goes through @romp/data repositories; only `firebase-admin` (app bootstrap) and
    // `firebase-admin/auth` (identity) are allowed here.
    allowedDataImports: ['firebase-admin', 'firebase-admin/auth'],
  }),
  {
    // Decorating the Fastify request (`request.caller`, `request.requestId`) is the
    // framework's own idiom for request-scoped state — it is how a verified caller is
    // attached in one hook and read in a handler. The workspace-wide `no-param-reassign`
    // with `props: true` would forbid it, so it is relaxed for exactly the plugin layer that
    // does the decorating, and nowhere else.
    files: ['src/plugins/**/*.ts'],
    rules: { 'no-param-reassign': ['error', { props: false }] },
  },
  {
    ignores: ['lib/**', 'coverage/**'],
  },
];
