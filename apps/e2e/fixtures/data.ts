/**
 * Shared data for the E2E flows.
 *
 * The customer flow creates a fresh account per run (a unique identifier keeps reruns from
 * colliding on "identifier already taken") and places an order the admin flow then verifies.
 * The order's human id is handed between specs through a file, since Playwright projects run
 * in separate processes — `orderHandoff` owns that.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const handoffPath = resolve(here, '..', '.e2e-state', 'order.json');

/** A unique-per-run customer, so a rerun never trips "identifier already registered". */
export function makeCustomer(): {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
} {
  const stamp = Date.now().toString(36);
  return {
    displayName: 'E2E Shopper',
    email: `e2e.shopper.${stamp}@example.com`,
    // Comfortably clears the password policy (length + varied words, no brand terms).
    password: 'copper lantern drift meadow',
  };
}

/** A valid delivery address for the checkout precondition. */
export const TEST_ADDRESS = {
  label: 'Home',
  recipientName: 'E2E Shopper',
  line1: '12 Test Street',
  line2: '',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  phone: '9845012345',
} as const;

/** A UTR that satisfies UtrSchema (6–64 chars, letters/digits after normalising). */
export const TEST_UTR = 'E2E123456789';

/** The seeded admin the orchestrator's emulator profile provisions. */
export const SEEDED_ADMIN = {
  email: 'owner@example.com',
  password: process.env.ADMIN_SEED_PASSWORD ?? 'e2e-admin-password-01',
} as const;

/** Persists the placed order's human id for the admin project to pick up. */
export function writeOrderHandoff(humanId: string): void {
  mkdirSync(dirname(handoffPath), { recursive: true });
  writeFileSync(handoffPath, JSON.stringify({ humanId }), 'utf8');
}

/** Reads the order handed off by the customer flow, or null if none was written. */
export function readOrderHandoff(): { readonly humanId: string } | null {
  try {
    return JSON.parse(readFileSync(handoffPath, 'utf8')) as { humanId: string };
  } catch {
    return null;
  }
}
