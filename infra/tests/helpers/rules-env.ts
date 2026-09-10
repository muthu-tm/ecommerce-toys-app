import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { doc, setDoc } from 'firebase/firestore';

import { DEMO_PROJECT_ID, readRules, requireEmulatorEndpoint } from './emulator';

/**
 * Shared setup for the rules suites.
 *
 * One environment per suite file, five callers, and a seeding helper that writes
 * through `withSecurityRulesDisabled` — because fixtures have to exist *before* a
 * rule can be tested against them, and writing them through the rules under test
 * would make the fixture setup depend on the thing being tested.
 *
 * The callers are named after the matrix columns in `SECURITY.md` so a test reads
 * against the document it is asserting.
 */

export interface RulesHarness {
  readonly env: RulesTestEnvironment;
  /** No `request.auth` at all — the storefront before sign-in. */
  readonly anonymous: () => Firestore;
  /** A signed-in customer with no role claim. */
  readonly customer: () => Firestore;
  /** A second customer, for every "someone else's document" case. */
  readonly otherCustomer: () => Firestore;
  /** `role: 'staff'` — backoffice, fulfilment, verification, moderation. */
  readonly staff: () => Firestore;
  /** `role: 'owner'` — everything staff can do, plus settings and refunds. */
  readonly owner: () => Firestore;
  /**
   * A caller whose claim is a role we never issue.
   *
   * Present because `role() == 'staff' || role() == 'owner'` is an allowlist, and an
   * allowlist is only demonstrably an allowlist if something outside it is refused.
   */
  readonly impostor: () => Firestore;
  /** Writes fixture documents with rules disabled. */
  readonly seed: (documents: Readonly<Record<string, Record<string, unknown>>>) => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

export const CUSTOMER_UID = 'customer-uid-0001';
export const OTHER_CUSTOMER_UID = 'customer-uid-0002';
export const STAFF_UID = 'staff-uid-0001';
export const OWNER_UID = 'owner-uid-0001';
export const IMPOSTOR_UID = 'impostor-uid-0001';

export async function createRulesHarness(): Promise<RulesHarness> {
  const firestore = requireEmulatorEndpoint('FIRESTORE_EMULATOR_HOST');

  const env = await initializeTestEnvironment({
    projectId: DEMO_PROJECT_ID,
    firestore: {
      rules: readRules('firestore.rules'),
      host: firestore.host,
      port: firestore.port,
    },
  });

  const as = (context: RulesTestContext): Firestore => context.firestore() as unknown as Firestore;

  return {
    env,
    anonymous: () => as(env.unauthenticatedContext()),
    customer: () => as(env.authenticatedContext(CUSTOMER_UID)),
    otherCustomer: () => as(env.authenticatedContext(OTHER_CUSTOMER_UID)),
    // The role lives in a custom claim, never in a Firestore document a client can
    // influence. `authenticatedContext` puts extra keys straight into the token,
    // which is exactly how the seeding script sets them in a real project.
    staff: () => as(env.authenticatedContext(STAFF_UID, { role: 'staff' })),
    owner: () => as(env.authenticatedContext(OWNER_UID, { role: 'owner' })),
    impostor: () => as(env.authenticatedContext(IMPOSTOR_UID, { role: 'superuser' })),

    seed: async (documents) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore() as unknown as Firestore;
        await Promise.all(
          Object.entries(documents).map(([path, data]) => setDoc(doc(db, path), data)),
        );
      });
    },

    cleanup: async () => {
      await env.cleanup();
    },
  };
}
