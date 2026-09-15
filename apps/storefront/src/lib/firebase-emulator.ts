/**
 * Client-SDK emulator wiring — the browser half of "run the whole stack locally".
 *
 * The server data layer (`src/server/firebase.ts`, Admin SDK) is already emulator-aware: it
 * reads `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` and the SDK routes itself.
 * The **browser** SDK has no such convention — `getAuth`/`getFirestore` talk to real
 * Firebase unless told otherwise — so customer login and the notification bell's realtime
 * listener cannot run offline without this. This module is that "otherwise".
 *
 * The decision (`emulatorConfig`) is a pure read of the environment, kept free of any
 * Firebase import so it is unit-testable in jsdom, where importing the client SDK aborts the
 * worker. The `connect*` helpers take the already-created SDK instance and the SDK's own
 * `connect*Emulator` function injected, so a test asserts *that* they are called, once, with
 * the resolved host — without loading the SDK.
 *
 * Opt-in and off by default: `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` must be exactly `'true'`.
 * A production build never sets it, so this is inert there — the connect calls are the only
 * behaviour and they are gated on the flag being read at call time.
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
  /** Firestore emulator host and port. */
  readonly firestore: HostPort;
}

const DEFAULT_AUTH_HOST = '127.0.0.1:9099';
const DEFAULT_FIRESTORE_HOST = '127.0.0.1:8181';

/**
 * Splits a `host:port` string into its parts, falling back to `fallback` when the value is
 * absent, empty or malformed. A bad host var should degrade to the documented default rather
 * than throw during SDK bootstrap and take the page down.
 */
export function parseHostPort(value: string | undefined, fallback: string): HostPort {
  const raw = value !== undefined && value.trim() !== '' ? value.trim() : fallback;
  // Strip a scheme if someone set `http://host:port`, then split on the last colon so an
  // IPv6 host without brackets still degrades to the fallback port rather than NaN.
  const withoutScheme = raw.replace(/^[a-z]+:\/\//iu, '');
  const lastColon = withoutScheme.lastIndexOf(':');
  if (lastColon === -1) {
    return parseHostPort(fallback === raw ? undefined : fallback, fallback);
  }
  const host = withoutScheme.slice(0, lastColon);
  const port = Number(withoutScheme.slice(lastColon + 1));
  if (host === '' || !Number.isInteger(port) || port <= 0) {
    // Malformed — use the fallback, but guard against infinite recursion when the fallback
    // itself is somehow bad by parsing it inline.
    const fbColon = fallback.lastIndexOf(':');
    return { host: fallback.slice(0, fbColon), port: Number(fallback.slice(fbColon + 1)) };
  }
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
    NEXT_PUBLIC_FIREBASE_FIRESTORE_HOST: process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_HOST,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  };
}

/** The synthetic API key the orchestrator injects. Never a real Google key. */
export const EMULATOR_API_KEY = 'emulator-api-key';

/**
 * Reads the emulator wiring decision from the environment.
 *
 * Pure and side-effect-free, so it is the unit-tested seam. `enabled` is a strict equality
 * check against `'true'` — any other value (including `'1'` or undefined) leaves it off,
 * unless the synthetic emulator API key is present: that key must never be sent to Google.
 */
export function emulatorConfig(
  env: Readonly<Record<string, string | undefined>> = processPublicEnv(),
): EmulatorConfig {
  const enabled =
    env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true' || env.NEXT_PUBLIC_FIREBASE_API_KEY === EMULATOR_API_KEY;
  const auth = parseHostPort(env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST, DEFAULT_AUTH_HOST);
  const firestore = parseHostPort(
    env.NEXT_PUBLIC_FIREBASE_FIRESTORE_HOST,
    DEFAULT_FIRESTORE_HOST,
  );
  return {
    enabled,
    authUrl: `http://${auth.host}:${String(auth.port)}`,
    firestore,
  };
}

/**
 * The idempotency guard.
 *
 * `connect*Emulator` must run exactly once per SDK instance — the Auth SDK throws if called
 * twice, and Next's dev hot reload re-imports this module, so a naive call double-connects.
 * A module-level set keyed by a stable label survives re-render within a worker; the SDK
 * instances themselves are memoised upstream, so one label per SDK is enough.
 */
const connected = new Set<string>();

/** Test-only: forget which instances have been connected, so a case starts clean. */
export function resetEmulatorConnections(): void {
  connected.clear();
}

/**
 * Wires an Auth instance to the emulator, once, when the flag is on.
 *
 * `connect` is injected (the SDK's `connectAuthEmulator`) so this is testable without the
 * SDK. `disableWarnings` suppresses the emulator's banner in the browser console — it is
 * expected in local dev, not a problem to surface.
 */
export function connectAuthToEmulator(
  authInstance: unknown,
  connect: (auth: unknown, url: string, options?: { disableWarnings: boolean }) => void,
  config: EmulatorConfig = emulatorConfig(),
): void {
  if (!config.enabled || connected.has('auth')) return;
  connect(authInstance, config.authUrl, { disableWarnings: true });
  connected.add('auth');
}

/** Wires a Firestore instance to the emulator, once, when the flag is on. */
export function connectFirestoreToEmulator(
  firestoreInstance: unknown,
  connect: (firestore: unknown, host: string, port: number) => void,
  config: EmulatorConfig = emulatorConfig(),
): void {
  if (!config.enabled || connected.has('firestore')) return;
  connect(firestoreInstance, config.firestore.host, config.firestore.port);
  connected.add('firestore');
}
