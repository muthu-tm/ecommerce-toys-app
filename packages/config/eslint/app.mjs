// @ts-check
/**
 * ESLint flat config for the app surfaces, with the white-label contract enforced.
 *
 * Consume it from an app's `eslint.config.mjs`:
 *
 *   import { readFileSync } from 'node:fs';
 *   import { createAppConfig } from '@romp/config/eslint/app';
 *
 *   const { brand } = JSON.parse(
 *     readFileSync('../../packages/store-config/generated/public-config.json', 'utf8'),
 *   );
 *
 *   export default createAppConfig({ brandNames: [brand.name, brand.legalName] });
 *
 * `brandNames` is required on purpose. Defaulting it to `[]` would mean an app whose
 * config forgot to supply it lints clean while hardcoding the brand everywhere — a
 * check that silently does nothing is worse than no check, because it is believed.
 */
import { reactConfig } from './react.mjs';
import { rompPlugin } from './plugin.mjs';

/**
 * @param {object} options
 * @param {readonly string[]} options.brandNames
 *   Brand strings to reject in app code — typically the configured store name and
 *   legal name.
 * @param {readonly string[]} [options.allowedIdentifiers]
 *   Identifiers or property names whose values may be literals. Use sparingly.
 * @param {readonly string[]} [options.files]
 *   Globs to apply the rule to. Defaults to all TypeScript and TSX.
 * @param {readonly string[]} [options.allowedDataImports]
 *   Firestore-adjacent packages this app may import directly, escaping the default
 *   restriction. `apps/api` needs `firebase-admin/auth`, because identity is not a
 *   Firestore concern and there is no repository to route it through. Nothing should
 *   ever need `firebase-admin/firestore`.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createAppConfig(options) {
  if (!Array.isArray(options?.brandNames)) {
    throw new TypeError(
      'createAppConfig requires `brandNames`. Read them from the generated store config so the rule actually has something to match.',
    );
  }

  const allowed = new Set(options.allowedDataImports ?? []);

  return [
    ...reactConfig,
    {
      files: options.files ? [...options.files] : ['**/*.ts', '**/*.tsx'],
      plugins: { romp: rompPlugin },
      rules: {
        'romp/no-hardcoded-brand': [
          'error',
          {
            brandNames: [...options.brandNames],
            allowedIdentifiers: [...(options.allowedIdentifiers ?? [])],
          },
        ],
      },
    },
    {
      /*
       * The enforcement mechanism behind the `SearchPort` and the repository layer.
       *
       * ADR-0002 names commitment #1 as "no `firestore` import outside the adapter", and
       * then says the honest thing about it: the port only holds if nobody bypasses it
       * under deadline pressure, and review discipline decays. This is the rule that
       * replaces review discipline.
       *
       * What it prevents is specific. A page that imports `firebase-admin/firestore` and
       * builds its own query bypasses three things at once: the converter that validates
       * documents, the caller parameter that filters by ownership — and the Admin SDK
       * bypasses security rules, so that filter is the only control there is — and the
       * containment that makes the Typesense swap a single new file.
       */
      files: options.files ? [...options.files] : ['**/*.ts', '**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              ...(allowed.has('firebase-admin')
                ? []
                : [
                    {
                      name: 'firebase-admin',
                      message:
                        'Reach Firestore through @romp/data. A direct Admin SDK read skips the validating converter and the ownership filter — and since the Admin SDK bypasses security rules, that filter is the only control (ADR-0001).',
                    },
                  ]),
              ...(allowed.has('firebase-admin/firestore')
                ? []
                : [
                    {
                      name: 'firebase-admin/firestore',
                      message:
                        'Use a repository from @romp/data, or add one. Building a query here bypasses the converter, the ownership filter and the SearchPort seam (ADR-0002).',
                    },
                  ]),
              ...(allowed.has('firebase-admin/auth')
                ? []
                : [
                    {
                      name: 'firebase-admin/auth',
                      message:
                        'Identity belongs to the API service. Pass a verified caller in rather than verifying tokens here.',
                    },
                  ]),
            ],
            patterns: allowed.has('@google-cloud/firestore')
              ? []
              : [
                  {
                    group: ['@google-cloud/firestore', '@google-cloud/firestore/*'],
                    message:
                      'This is the Admin SDK by another name. Reach Firestore through @romp/data.',
                  },
                ],
          },
        ],
      },
    },
    {
      // Generated artefacts legitimately contain literal colours and brand strings —
      // they are the output of the token emitter, not hand-written code.
      files: ['**/generated/**'],
      rules: { 'romp/no-hardcoded-brand': 'off' },
    },
  ];
}

export default createAppConfig;
