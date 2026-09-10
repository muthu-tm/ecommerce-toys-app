import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The `demo-` prefix is meaningful to the Firebase emulators: it guarantees the
 * suite runs fully offline and can never reach a real project, even if
 * credentials happen to be present in the environment.
 */
export const DEMO_PROJECT_ID = 'demo-romp';

const infraDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface EmulatorEndpoint {
  readonly host: string;
  readonly port: number;
}

/**
 * Reads an emulator endpoint from the environment.
 *
 * These variables are injected by `firebase emulators:exec`. Their absence means
 * the suite is not running under the emulators, which we treat as a hard failure
 * rather than falling back to a default — a silent fallback is how a test suite
 * ends up writing to a real project.
 */
export function requireEmulatorEndpoint(variable: string): EmulatorEndpoint {
  const raw = process.env[variable];
  if (raw === undefined || raw === '') {
    throw new Error(
      `${variable} is not set. Run this suite through \`pnpm --filter @romp/infra test\`, which starts the emulators first.`,
    );
  }

  // Values look like "127.0.0.1:8080". Take the last colon so an IPv6 host
  // does not get mangled.
  const separator = raw.lastIndexOf(':');
  if (separator === -1) {
    throw new Error(`${variable} is malformed: expected "host:port", got "${raw}".`);
  }

  const host = raw.slice(0, separator);
  const port = Number.parseInt(raw.slice(separator + 1), 10);
  if (host === '' || Number.isNaN(port)) {
    throw new Error(`${variable} is malformed: expected "host:port", got "${raw}".`);
  }

  return { host, port };
}

/** Reads a rules file from this package by name, e.g. `firestore.rules`. */
export function readRules(fileName: string): string {
  return readFileSync(join(infraDir, fileName), 'utf8');
}
