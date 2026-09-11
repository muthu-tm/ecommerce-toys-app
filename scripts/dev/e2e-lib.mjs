/**
 * Pure helpers for the local E2E orchestrator (`e2e.mjs`).
 *
 * Everything here is side-effect-free and dependency-free so it can be unit-tested without
 * spawning a process or touching the network. The orchestrator itself does the spawning,
 * probing and file I/O; this module decides *what* — the service list, the profile env, the
 * health-probe verdicts, the status table text.
 */

/** Emulator ports, mirroring firebase.json. */
export const PORTS = Object.freeze({
  auth: 9099,
  firestore: 8181,
  storage: 9199,
  functions: 5001,
  pubsub: 8085,
  ui: 4000,
  hub: 4400,
  api: 8787,
  storefront: 3000,
  admin: 3001,
});

/** The four long-lived services the orchestrator manages, in start order. */
export const SERVICES = Object.freeze(['emulators', 'api', 'storefront', 'admin']);

/**
 * The emulator-profile environment, layered over the current process env.
 *
 * This is the canonical source the `.env.e2e.example` documents. Returned as a plain object
 * so a test can assert the whole contract, and so the orchestrator can merge it into each
 * spawn's env. `overrides` (from an optional `.env.e2e`) win over these defaults.
 */
export function emulatorProfileEnv(storeId = 'romp', overrides = {}) {
  const project = `demo-${storeId}`;
  return {
    STORE_ID: storeId,
    NEXT_PUBLIC_STORE_ID: storeId,
    GCLOUD_PROJECT: project,
    GOOGLE_CLOUD_PROJECT: project,
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${PORTS.firestore}`,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${PORTS.auth}`,
    FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${PORTS.storage}`,
    PORT: String(PORTS.api),
    CORS_ORIGINS: `http://localhost:${PORTS.storefront},http://localhost:${PORTS.admin}`,
    CART_COOKIE_SECRET: 'dev-e2e-cart-cookie-secret',
    // A known admin password so the Playwright admin flow can sign in deterministically.
    // Honoured by seed:admins ONLY against the Auth emulator, so it is inert anywhere real.
    ADMIN_SEED_PASSWORD: 'e2e-admin-password-01',
    NEXT_PUBLIC_API_BASE_URL: `http://localhost:${PORTS.api}`,
    NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${PORTS.auth}`,
    NEXT_PUBLIC_FIREBASE_FIRESTORE_HOST: `127.0.0.1:${PORTS.firestore}`,
    NEXT_PUBLIC_FIREBASE_STORAGE_HOST: `127.0.0.1:${PORTS.storage}`,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
    NEXT_PUBLIC_FIREBASE_API_KEY: 'emulator-api-key',
    NEXT_PUBLIC_FIREBASE_APP_ID: 'emulator-app-id',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`,
    ...overrides,
  };
}

/**
 * The firebase profile environment: real config from the process env, no emulator wiring.
 *
 * The orchestrator's `--profile firebase` path relies on the operator having set the real
 * `NEXT_PUBLIC_FIREBASE_*` and `GOOGLE_CLOUD_PROJECT` in their shell or `.env.local`; this
 * only strips the emulator host vars so the SDKs talk to the real backend, and sets the
 * store + CORS defaults that are the same in both profiles.
 */
export function firebaseProfileEnv(storeId = 'romp', overrides = {}) {
  return {
    STORE_ID: storeId,
    NEXT_PUBLIC_STORE_ID: storeId,
    PORT: String(PORTS.api),
    CORS_ORIGINS: `http://localhost:${PORTS.storefront},http://localhost:${PORTS.admin}`,
    NEXT_PUBLIC_API_BASE_URL: `http://localhost:${PORTS.api}`,
    ...overrides,
  };
}

/** Parses a very small subset of dotenv (KEY=VALUE lines, # comments, blank lines). */
export function parseDotenv(text) {
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== '') out[key] = value;
  }
  return out;
}

/** CLI argument parse: the command and flags the orchestrator understands. */
export function parseArgs(argv) {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const command = positional[0] ?? 'help';
  const target = positional[1]; // e.g. `logs <service>`
  const profileFlag = argv.find((a) => a.startsWith('--profile'));
  const profile = profileFlag ? (profileFlag.split('=')[1] ?? 'emulator') : 'emulator';
  return {
    command,
    target,
    profile: profile === 'firebase' ? 'firebase' : 'emulator',
    follow: argv.includes('--follow') || argv.includes('-f'),
  };
}

/**
 * Turns an HTTP status (or a thrown error) into a probe verdict.
 *
 * `acceptable` is the set of status codes that mean "up" for this probe — a Next dev server
 * answering 200 on `/`, the API answering 200 on `/v1/health`, the emulator Hub 200 on `/`.
 * A network error (server not listening) is `down`; an unexpected status is `unhealthy`.
 */
export function probeVerdict({ status, error }, acceptable = [200]) {
  if (error !== undefined && error !== null) return { ok: false, state: 'down', detail: error };
  if (acceptable.includes(status)) return { ok: true, state: 'up', detail: `HTTP ${status}` };
  return { ok: false, state: 'unhealthy', detail: `HTTP ${status}` };
}

/** Formats one status row for the table — fixed-width so columns line up. */
export function formatStatusRow(name, verdict, url) {
  const mark = verdict.ok ? '✓' : '✗';
  const state = verdict.state.toUpperCase().padEnd(9);
  return `  ${mark} ${name.padEnd(11)} ${state} ${url.padEnd(30)} ${verdict.detail}`;
}

/** Whether a set of checks all passed — the process exit signal. */
export function allPassed(results) {
  return results.every((r) => r.verdict.ok);
}
