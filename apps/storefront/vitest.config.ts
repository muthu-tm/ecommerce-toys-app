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
    // Admin SDK bootstrapping: credential resolution, connection pooling, the emulator
    // vs ADC vs service-account branches. None of it is logic that a jsdom unit test can
    // meaningfully exercise — it only runs correctly against a real runtime or the
    // emulator, and the emulator path is covered end to end by `infra/tests`. Unit-testing
    // it would mean asserting against mocks of the SDK, which tests the mocks. The one
    // piece with real logic, `catalogueAvailable`, is a pure env check covered in
    // `server/catalogue.test.ts`. Same reasoning as `@romp/infra`'s `coverage: false`.
    'src/server/firebase.ts',
    // Route-level loading states are three-line skeleton wrappers rendered by Next's
    // Suspense machinery, not by anything a test drives. `ProductGridSkeleton` — the part
    // with a shape worth asserting — is tested directly.
    'src/app/**/loading.tsx',
    // Client Firebase SDK glue. `firebase-client.ts` is the browser SDK bootstrap (the
    // client analogue of `server/firebase.ts`), and `use-notifications.ts` is a thin
    // `onSnapshot` subscription over it. The client SDK aborts a jsdom worker on import, so
    // it cannot be unit-tested here; the subscription is exercised against the emulator in
    // `infra/tests` and the bell's behaviour is covered with the hook mocked. The pure
    // pieces — day grouping and the badge cap in `notifications-view.ts` — are tested
    // directly. Same reasoning as the Admin SDK bootstrap.
    'src/lib/firebase-client.ts',
    'src/lib/use-notifications.ts',
  ],
});

const fromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const config: ViteUserConfig = {
  ...base,
  plugins: [react()],
  resolve: {
    // Array form, because order matters: the generated-fonts entry has to be matched
    // before the general `@/` rule.
    alias: [
      {
        // The generated fonts module calls `next/font/google`, a build-time transform
        // whose exports are not callable outside `next build`. Aliasing this app-local
        // module is deterministic; intercepting the `node_modules` import is not, because
        // Vitest externalises those and Vite's resolver never sees them.
        find: /^@\/generated\/fonts$/u,
        replacement: fromHere('./src/test-stubs/fonts.ts'),
      },
      {
        // `server-only` throws by design when imported into a client module, and jsdom is
        // a client environment. Aliasing it to an empty module lets a server component be
        // rendered in a test — the marker's real job (blocking a *browser bundle* from
        // shipping the Admin SDK) is enforced by `next build`, not by the test runner.
        find: /^server-only$/u,
        replacement: fromHere('./src/test-stubs/empty.ts'),
      },
      {
        // Mirrors the `@/*` path in tsconfig, which Vitest does not read.
        find: /^@\//u,
        replacement: `${fromHere('./src')}/`,
      },
    ],
  },
};

export default config;
