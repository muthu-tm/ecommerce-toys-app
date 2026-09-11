/**
 * `pnpm e2e test` — a quick smoke of a running stack.
 *
 * Two layers, because "the port answers" is not "the service works":
 *
 *   1. Liveness — the emulator Hub, the API health endpoint, the storefront and admin home
 *      pages all respond. This is the same set `status` probes.
 *   2. A shallow functional pass — the API's public cart endpoint returns 200 (proving the
 *      API is wired to the Firestore emulator, not merely listening), and the storefront home
 *      HTML contains a seeded product name (proving SSR read the seeded catalogue, not that it
 *      rendered an empty shell). This is what catches "up but empty/misconfigured".
 *
 * Exits non-zero on any failure, naming the check that failed, so it is usable in a script or
 * a pre-flight before the Playwright run.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function out(message = '') {
  process.stdout.write(`${message}\n`);
}

async function probe(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A seeded product name to look for in the storefront home HTML.
 *
 * Read from the store's catalogue seed rather than hardcoded, so this stays correct for a
 * second store and does not trip the no-hardcoded-brand rule (this is an .mjs script outside
 * the lint scope, but keeping content out of the script is the right instinct regardless).
 */
function expectedProductName(storeId) {
  const seedPath = resolve(repoRoot, 'stores', storeId, 'seed.catalogue.ts');
  const source = readFileSync(seedPath, 'utf8');
  const match = source.match(/name:\s*'([^']+)'/u) ?? source.match(/name:\s*"([^"]+)"/u);
  return match?.[1] ?? null;
}

/** Runs one named check, records the result, prints a line. */
async function check(results, name, fn) {
  try {
    const { ok, detail } = await fn();
    results.push({ name, ok });
    out(`  ${ok ? '✓' : '✗'} ${name.padEnd(34)} ${detail}`);
  } catch (error) {
    results.push({ name, ok: false });
    out(`  ✗ ${name.padEnd(34)} ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runQuickTest({ PORTS, STORE_ID }) {
  out('Quick test — liveness + shallow functional pass');
  out('');
  const results = [];

  // --- liveness ---
  await check(results, 'emulators (hub :4400)', async () => {
    const r = await probe(`http://127.0.0.1:${PORTS.hub}/`);
    return { ok: r.status === 200, detail: r.error ?? `HTTP ${r.status}` };
  });
  await check(results, 'api (/v1/health)', async () => {
    const r = await probe(`http://127.0.0.1:${PORTS.api}/v1/health`);
    const healthy = r.status === 200 && (r.body ?? '').includes('"status":"ok"');
    return { ok: healthy, detail: r.error ?? `HTTP ${r.status}` };
  });
  await check(results, 'storefront (:3000)', async () => {
    const r = await probe(`http://127.0.0.1:${PORTS.storefront}/`);
    return { ok: r.status === 200, detail: r.error ?? `HTTP ${r.status}` };
  });
  await check(results, 'admin (:3001)', async () => {
    const r = await probe(`http://127.0.0.1:${PORTS.admin}/`);
    const ok = [200, 307, 308].includes(r.status);
    return { ok, detail: r.error ?? `HTTP ${r.status}` };
  });

  // --- functional ---
  await check(results, 'api cart reads firestore', async () => {
    const r = await probe(`http://127.0.0.1:${PORTS.api}/v1/cart`);
    return { ok: r.status === 200, detail: r.error ?? `HTTP ${r.status}` };
  });
  await check(results, 'storefront renders seeded catalogue', async () => {
    const name = expectedProductName(STORE_ID);
    if (name === null) return { ok: false, detail: 'no seeded product name found in catalogue' };
    const r = await probe(`http://127.0.0.1:${PORTS.storefront}/`);
    const found = (r.body ?? '').includes(name);
    return { ok: found, detail: found ? `found "${name}"` : `"${name}" not in home HTML` };
  });

  out('');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  if (failed === 0) {
    out(`All ${String(results.length)} checks passed.`);
    process.exit(0);
  }
  out(`${String(failed)} of ${String(results.length)} checks failed.`);
  process.exit(1);
}
