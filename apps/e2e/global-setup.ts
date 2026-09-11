import type { FullConfig } from '@playwright/test';

/**
 * Verifies the local stack is up before any spec runs.
 *
 * The suite needs the emulators, API, storefront and admin all live and the catalogue seeded.
 * Bringing those up is the orchestrator's job (`pnpm e2e start`) — it needs a JDK, an ordered
 * start and seeding — so this does not start them; it checks them, and fails with the exact
 * command to run if they are missing. That turns "Playwright hung for 60s then failed on a
 * blank page" into "the stack is not up: run pnpm e2e start".
 */

const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3000';
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001';
const API_URL = process.env.API_URL ?? 'http://localhost:8787';

interface Check {
  readonly name: string;
  readonly url: string;
  readonly accept: readonly number[];
}

async function probe(url: string): Promise<{ status?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 3000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { status: res.status };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const checks: Check[] = [
    { name: 'API', url: `${API_URL}/v1/health`, accept: [200] },
    { name: 'storefront', url: `${STOREFRONT_URL}/`, accept: [200] },
    { name: 'admin', url: `${ADMIN_URL}/`, accept: [200, 307, 308] },
  ];

  const failures: string[] = [];
  for (const check of checks) {
    const result = await probe(check.url);
    if (result.status === undefined || !check.accept.includes(result.status)) {
      failures.push(
        `  · ${check.name} (${check.url}) — ${result.error ?? `HTTP ${String(result.status)}`}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      [
        'The local stack is not ready for E2E:',
        ...failures,
        '',
        'Start it first, then re-run the tests:',
        '  pnpm e2e start        # emulators + seed + api + storefront + admin',
        '  pnpm e2e test         # optional: confirm all green',
        '  pnpm --filter @romp/e2e test:e2e',
      ].join('\n'),
    );
  }
}
