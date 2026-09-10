import { readFileSync } from 'node:fs';

import { createAppConfig } from '@romp/config/eslint/app';

/**
 * The white-label contract, enforced in the backoffice too.
 *
 * The admin renders store copy (labels, empty states) exactly as the storefront does, so a
 * hardcoded brand name here would ship one store's name into another store's backoffice.
 * Brand names come from the generated store config, so the rule rejects them in that store's
 * build. If the generated file is missing this throws rather than falling back to an empty
 * list — a brand rule with nothing to match passes silently while the brand is hardcoded.
 */
const generatedConfigPath = new URL('./src/generated/public-config.json', import.meta.url);

let brand;
try {
  ({ brand } = JSON.parse(readFileSync(generatedConfigPath, 'utf8')));
} catch (cause) {
  throw new Error(
    'apps/admin: src/generated/public-config.json is missing. Run `pnpm store:tokens` before linting.',
    { cause },
  );
}

export default [
  ...createAppConfig({
    brandNames: [brand.name, brand.legalName],
    files: ['src/**/*.ts', 'src/**/*.tsx'],
  }),
  {
    // The server data layer is the one sanctioned place to hold the Admin SDK, exactly as
    // in the storefront. Every other file is forbidden from importing `firebase-admin`.
    files: ['src/server/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    ignores: ['.next/**', 'src/generated/**', 'next-env.d.ts'],
  },
];
