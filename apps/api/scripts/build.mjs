// @ts-check
/**
 * Bundles the API into a single self-contained `lib/index.js` for Cloud Functions.
 *
 * A monorepo Function cannot ship its `node_modules` — the workspace `@romp/*` packages are
 * symlinks and the deployed artefact must resolve them. esbuild bundles the whole
 * dependency graph into one file, so the deploy uploads `lib/` and a `package.json`
 * declaring only the runtime-provided externals, and nothing depends on the workspace layout
 * surviving the upload.
 *
 * `firebase-functions` and `firebase-admin` are marked external: the Cloud Functions runtime
 * provides them, and bundling them would both bloat the artefact and risk a version skew
 * with the platform's own copy. Everything else — Fastify, zod, libphonenumber-js, the
 * `@romp/*` packages — is bundled in.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // The runtime provides these; everything else is bundled so the artefact is
  // self-contained and independent of the workspace symlink layout.
  external: ['firebase-functions', 'firebase-admin', 'firebase-admin/*'],
  // Firebase reads the deployed package.json's `main`; the banner keeps `import.meta.url`
  // working under the bundled ESM output for any dynamic import that needs it.
  logLevel: 'info',
});
