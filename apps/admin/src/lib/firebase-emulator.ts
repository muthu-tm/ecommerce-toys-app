/**
 * Client-SDK emulator wiring — the backoffice browser half of "run the whole stack locally".
 *
 * The admin's server data layer (`src/server/firebase.ts`, Admin SDK) is already
 * emulator-aware. The **browser** SDK is not: the operator's Auth (which mints the bearer
 * token every API write carries) and the direct-to-Storage product-image upload both talk to
 * real Firebase unless told otherwise. This module is that "otherwise".
 *
 * The decision (`emulatorConfig`) is a pure read of the environment, free of any Firebase
 * import so it is unit-testable in jsdom, where importing the client SDK aborts the worker.
 * The `connect*` helpers take the already-created SDK instance and the SDK's own
 * `connect*Emulator` function injected, so a test asserts they are called once with the
 * resolved host — without loading the SDK. It mirrors the storefront's helper; the difference
 * is Storage in place of Firestore, since the backoffice's client SDK use is auth + uploads.
 *
 * Opt-in and off by default: `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` must be exactly `'true'`.
 */

/** A parsed `host:port`. */
export interface HostPort {
  readonly host: string;
  readonly port: number;
}

export interface EmulatorConfig {
  /** Whether client-SDK emulator wiring is enabled at all. */
  readonly enabled: boolean;
  /** Auth emulator origin, e.g. `http://127.0.0.1:9099`. */
  readonly authUrl: string;
  /** Storage emulator host and port. */
  readonly storage: HostPort;
}

const DEFAULT_AUTH_HOST = '127.0.0.1:9099';
const DEFAULT_STORAGE_HOST = '127.0.0.1:9199';

/**
 * Splits a `host:port` string into its parts, falling back to `fallback` when the value is
 * absent, empty or malformed. A bad host var should degrade to the documented default rather
 * than throw during SDK bootstrap and take the page down.
 */
export function parseHostPort(value: string | undefined, fallback: string): HostPort {
  const raw = value !== undefined && value.trim() !== '' ? value.trim() : fallback;
  const withoutScheme = raw.replace(/^[a-z]+:\/\//iu, '');
  const lastColon = withoutScheme.lastIndexOf(':');
  const fbColon = fallback.lastIndexOf(':');
  const fbHostPort = { host: fallback.slice(0, fbColon), port: Number(fallback.slice(fbColon + 1)) };
  if (lastColon === -1) return fbHostPort;
  const host = withoutScheme.slice(0, lastColon);
  const port = Number(withoutScheme.slice(lastColon + 1));
  if (host === '' || !Number.isInteger(port) || port <= 0) return fbHostPort;
  return { host, port };
}

/**
 * Next.js only inlines `NEXT_PUBLIC_*` values that appear as a **static** member access
 * (`process.env.NEXT_PUBLIC_FOO`). Passing `process.env` as an object and reading
 * `env.FOO` is `undefined` in the browser, which left the client SDK talking to real
 * Google endpoints with the synthetic emulator API key.
 *
 * Tests inject `env` explicitly. The default path must spell each key so the bundler
 * can replace them.
 */
function processPublicEnv(): Readonly<Record<string, string | undefined>> {
  return {
    NEXT_PUBLIC_USE_FIREBASE_EMULATOR: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    NEXT_PUBLIC_FIREBASE_STORAGE_HOST: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_HOST,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  };
}

/** The synthetic API key the orchestrator injects. Never a real Google key. */
export const EMULATOR_API_KEY = 'emulator-api-key';

/**
 * Reads the emulator wiring decision from the environment.
 *
 * Pure and side-effect-free, the unit-tested seam. `enabled` is a strict equality check
 * against `'true'` — any other value leaves it off, unless the synthetic emulator API
 * key is present: that key must never be sent to Google.
 */
export function emulatorConfig(
  env: Readonly<Record<string, string | undefined>> = processPublicEnv(),
): EmulatorConfig {
  const enabled =
    env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true' || env.NEXT_PUBLIC_FIREBASE_API_KEY === EMULATOR_API_KEY;
  const auth = parseHostPort(env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST, DEFAULT_AUTH_HOST);
  const storage = parseHostPort(env.NEXT_PUBLIC_FIREBASE_STORAGE_HOST, DEFAULT_STORAGE_HOST);
  return {
    enabled,
    authUrl: `http://${auth.host}:${String(auth.port)}`,
    storage,
  };
}

/**
 * The idempotency guard. `connect*Emulator` must run exactly once per SDK instance — the Auth
 * SDK throws on a second call, and Next's dev hot reload re-imports this module.
 */
const connected = new Set<string>();

/** Test-only: forget which instances have been connected, so a case starts clean. */
export function resetEmulatorConnections(): void {
  connected.clear();
}

/** Wires an Auth instance to the emulator, once, when the flag is on. */
export function connectAuthToEmulator(
  authInstance: unknown,
  connect: (auth: unknown, url: string, options?: { disableWarnings: boolean }) => void,
  config: EmulatorConfig = emulatorConfig(),
): void {
  if (!config.enabled || connected.has('auth')) return;
  connect(authInstance, config.authUrl, { disableWarnings: true });
  connected.add('auth');
}

/** Wires a Storage instance to the emulator, once, when the flag is on. */
export function connectStorageToEmulator(
  storageInstance: unknown,
  connect: (storage: unknown, host: string, port: number) => void,
  config: EmulatorConfig = emulatorConfig(),
): void {
  if (!config.enabled || connected.has('storage')) return;
  connect(storageInstance, config.storage.host, config.storage.port);
  connected.add('storage');
}
