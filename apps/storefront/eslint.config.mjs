import { readFileSync } from 'node:fs';

import { createAppConfig } from '@romp/config/eslint/app';

/**
 * The white-label contract, enforced.
 *
 * Brand names are read from the generated config rather than hardcoded here, so a second
 * store's names are rejected in its own build without editing this file.
 *
 * If the generated file is missing, this throws rather than falling back to an empty list.
 * A lint rule with nothing to match passes silently while the brand is hardcoded
 * everywhere, and a check that quietly does nothing is worse than no check — it is
 * believed. `pnpm store:tokens` is wired into `pretest`, `predev` and `prebuild`.
 */
const generatedConfigPath = new URL('./src/generated/public-config.json', import.meta.url);

let brand;
try {
  ({ brand } = JSON.parse(readFileSync(generatedConfigPath, 'utf8')));
} catch (cause) {
  throw new Error(
    'apps/storefront: src/generated/public-config.json is missing. Run `pnpm store:tokens` before linting.',
    { cause },
  );
}

export default [
  ...createAppConfig({
    brandNames: [brand.name, brand.legalName],
    files: ['src/**/*.ts', 'src/**/*.tsx'],
  }),
  {
    // The server data layer is the one sanctioned place to hold the Admin SDK. Every
    // other file in the app is still forbidden from importing `firebase-admin`, so this
    // narrow allowance is what makes the app-wide restriction meaningful rather than
    // absolute — there is exactly one door, and it is marked `server-only`.
    files: ['src/server/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Generated artefacts and build output are not hand-written code.
    ignores: ['.next/**', 'src/generated/**', 'next-env.d.ts'],
  },
];
