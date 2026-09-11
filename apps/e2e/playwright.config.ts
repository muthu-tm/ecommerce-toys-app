import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the ROMP local E2E suite.
 *
 * The suite runs against the **live emulator stack** — the same one `pnpm e2e start` brings
 * up — not against a mock. That is the whole point: it exercises the real browser SDK talking
 * to the Auth and Firestore emulators, the real API, and real SSR reads of the seeded
 * catalogue. `global-setup.ts` verifies the stack is up and fails fast with instructions if it
 * is not, rather than Playwright timing out obscurely on the first `goto`.
 *
 * Two projects, because the flows live on two origins:
 *   - `customer` → the storefront on :3000 (register, browse, cart, checkout, order)
 *   - `admin`    → the backoffice on :3001 (verify payment, fulfil)
 * `baseURL` is set per project so a spec uses relative paths and stays origin-agnostic.
 */

const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3000';
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001';

export default defineConfig({
  testDir: './tests',
  // The customer flow places an order the admin flow then acts on, so specs are ordered and
  // must not race each other. Serial, single worker — correctness over speed for a smoke suite.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'customer',
      testMatch: /customer\.spec\.ts/u,
      use: { ...devices['Desktop Chrome'], baseURL: STOREFRONT_URL },
    },
    {
      name: 'admin',
      testMatch: /admin\.spec\.ts/u,
      // The admin flow depends on the order the customer flow places.
      dependencies: ['customer'],
      use: { ...devices['Desktop Chrome'], baseURL: ADMIN_URL },
    },
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/u,
      use: { ...devices['Desktop Chrome'], baseURL: STOREFRONT_URL },
    },
  ],
});
