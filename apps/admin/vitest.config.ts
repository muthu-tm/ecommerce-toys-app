import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import type { ViteUserConfig } from 'vitest/config';

import { createVitestConfig } from '@romp/config/vitest';

const base = createVitestConfig({
  tier: 'ui',
  environment: 'jsdom',
  include: ['src/**/*.{test,spec}.{ts,tsx}'],
  setupFiles: ['./src/test-setup.ts'],
  coverageExclude: [
    // Admin SDK bootstrap — credential resolution and connection pooling that only runs
    // against a real runtime or the emulator, exercised end to end by `infra/tests`. Same
    // reasoning as the storefront's `server/firebase.ts` exclusion.
    'src/server/firebase.ts',
    // Client Firebase SDK glue: the auth bootstrap and the token/session plumbing that talk
    // to the browser SDK, which aborts a jsdom worker on import. The pure pieces are tested
    // directly; the glue is exercised against the emulator and in the browser.
    'src/lib/firebase-client.ts',
    'src/lib/auth.ts',
    // The API fetch client — network glue. The request bodies it sends are built and tested
    // in `product-form.ts`; asserting the fetch itself would test the mock.
    'src/lib/api.ts',
    // Route-level loading states are Suspense wrappers Next renders, not logic a test drives.
    'src/app/**/loading.tsx',
    // The whole server read layer holds the Admin SDK and only runs correctly against a
    // datastore — the same reasoning as `server/firebase.ts`. Its reads are the repositories
    // in `@romp/data`, covered at the domain tier and end to end in `infra/tests`; the layer
    // here is thin caching + the staff-caller default, which a jsdom unit test cannot
    // exercise without mocking the SDK (which tests the mock).
    'src/server/**',
    // Server-component pages are `async` route entries that read through the server layer and
    // compose the client components. Next renders them; a jsdom test cannot mount an async
    // server component, and the composition they do is asserted through the components
    // themselves. The layout is the same — a server shell around the tested pieces.
    'src/app/**/page.tsx',
    'src/app/layout.tsx',
  ],
});

const fromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const config: ViteUserConfig = {
  ...base,
  plugins: [react()],
  resolve: {
    alias: [
      {
        // The generated fonts module calls `next/font/google`, uncallable outside a build.
        find: /^@\/generated\/fonts$/u,
        replacement: fromHere('./src/test-stubs/fonts.ts'),
      },
      {
        // `server-only` throws when imported into a client module; jsdom is a client
        // environment, so it is aliased to an empty module for tests.
        find: /^server-only$/u,
        replacement: fromHere('./src/test-stubs/empty.ts'),
      },
      {
        find: /^@\//u,
        replacement: `${fromHere('./src')}/`,
      },
    ],
  },
};

export default config;
