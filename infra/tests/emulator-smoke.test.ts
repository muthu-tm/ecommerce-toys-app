import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEMO_PROJECT_ID, readRules, requireEmulatorEndpoint } from './helpers/emulator';

/**
 * Emulator smoke test.
 *
 * This is the Task 2 acceptance gate. It is deliberately not a rules test suite
 * — Task 6 owns that — but it proves the wiring every later phase depends on:
 *
 *   - the emulators start and are reachable;
 *   - the Admin SDK read/write path works, which is how Next.js server
 *     components and Cloud Functions reach Firestore (ADR-0001);
 *   - the Email/Password provider accepts the internal alias address format
 *     that mobile-number login is built on (ADR-0006);
 *   - `firebase.json` really points at `infra/*.rules`, proven by observing a
 *     client access being denied. Without this assertion, a misconfigured rules
 *     path would look identical to working rules until something leaked.
 */

let adminApp: App;
let adminDb: Firestore;
let rulesEnv: RulesTestEnvironment;

beforeAll(async () => {
  const firestore = requireEmulatorEndpoint('FIRESTORE_EMULATOR_HOST');
  const storage = requireEmulatorEndpoint('FIREBASE_STORAGE_EMULATOR_HOST');

  adminApp = initializeApp({ projectId: DEMO_PROJECT_ID }, `smoke-${Date.now().toString()}`);
  adminDb = getFirestore(adminApp);

  rulesEnv = await initializeTestEnvironment({
    projectId: DEMO_PROJECT_ID,
    firestore: {
      rules: readRules('firestore.rules'),
      host: firestore.host,
      port: firestore.port,
    },
    storage: {
      rules: readRules('storage.rules'),
      host: storage.host,
      port: storage.port,
    },
  });
});

afterAll(async () => {
  await rulesEnv.cleanup();
  await deleteApp(adminApp);
});

describe('emulator wiring', () => {
  it('is running against the emulators, not a real project', () => {
    // If these are unset, every other assertion below would be executing against
    // whatever project the ambient credentials point at.
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeDefined();
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBeDefined();
    expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST).toBeDefined();
    expect(DEMO_PROJECT_ID.startsWith('demo-')).toBe(true);
  });
});

describe('Firestore via the Admin SDK', () => {
  it('round-trips a document and resolves server timestamps', async () => {
    const reference = adminDb.collection('_smoke').doc('round-trip');

    await reference.set({
      note: 'written by the Task 2 smoke test',
      totalMinor: 384998,
      createdAt: FieldValue.serverTimestamp(),
    });

    const snapshot = await reference.get();
    const data = snapshot.data();

    expect(snapshot.exists).toBe(true);
    expect(data?.note).toBe('written by the Task 2 smoke test');
    // Money is an integer count of paise, never a float (ADR-0004).
    expect(data?.totalMinor).toBe(384998);
    expect(Number.isInteger(data?.totalMinor)).toBe(true);
    expect(data?.createdAt).toBeDefined();

    await reference.delete();
  });

  it('commits a transaction across two documents', async () => {
    // The order path depends on multi-document transactions — reserving stock
    // and decrementing inventory must succeed or fail together (Task 16).
    const inventory = adminDb.collection('_smoke').doc('inventory');
    const reservation = adminDb.collection('_smoke').doc('reservation');

    await inventory.set({ available: 5 });

    await adminDb.runTransaction(async (tx) => {
      const current = await tx.get(inventory);
      const available = (current.data()?.available as number | undefined) ?? 0;
      tx.update(inventory, { available: available - 1 });
      tx.set(reservation, { quantity: 1 });
    });

    expect((await inventory.get()).data()?.available).toBe(4);
    expect((await reservation.get()).data()?.quantity).toBe(1);

    await Promise.all([inventory.delete(), reservation.delete()]);
  });
});

describe('Auth via the Admin SDK', () => {
  it('creates an email/password user', async () => {
    const auth = getAuth(adminApp);
    const user = await auth.createUser({
      email: 'asha@example.com',
      password: 'correct-horse-battery-staple',
      displayName: 'Asha',
    });

    const fetched = await auth.getUserByEmail('asha@example.com');

    expect(fetched.uid).toBe(user.uid);
    expect(fetched.providerData.map((provider) => provider.providerId)).toContain('password');

    await auth.deleteUser(user.uid);
  });

  it('accepts the internal alias address that mobile login depends on', async () => {
    // ADR-0006: a mobile number is normalised to E.164 and mapped to a
    // deterministic alias on a non-routable domain, so one Firebase provider
    // serves both email and mobile login. If the provider rejected this address
    // shape, the whole identity design would be unworkable — so it is asserted
    // here, before Task 10 builds on it.
    const auth = getAuth(adminApp);
    const alias = 'p.919845021174@auth.romp.internal';

    const user = await auth.createUser({ email: alias, password: 'a-sufficiently-long-secret' });
    const fetched = await auth.getUserByEmail(alias);

    expect(fetched.uid).toBe(user.uid);
    expect(fetched.email).toBe(alias);

    await auth.deleteUser(user.uid);
  });

  it('rejects a duplicate identifier', async () => {
    // Uniqueness of the login identifier is enforced by Auth itself, which is
    // what `identityIndex` complements rather than replaces.
    const auth = getAuth(adminApp);
    const user = await auth.createUser({
      email: 'duplicate@example.com',
      password: 'a-sufficiently-long-secret',
    });

    await expect(
      auth.createUser({ email: 'duplicate@example.com', password: 'another-long-secret' }),
    ).rejects.toThrow();

    await auth.deleteUser(user.uid);
  });
});

describe('security rules are loaded from infra/', () => {
  it('denies an unauthenticated client read', async () => {
    // Proves firebase.json resolves infra/firestore.rules. A broken path would
    // otherwise leave the emulator permissive and this test passing for the
    // wrong reason.
    const db = rulesEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, '_smoke/round-trip')));
  });

  it('denies an authenticated client read', async () => {
    // Deny-all, not merely auth-gated: Task 6 opens specific paths deliberately.
    const db = rulesEnv.authenticatedContext('customer-uid').firestore();
    await assertFails(getDoc(doc(db, '_smoke/round-trip')));
  });

  it('denies a client write', async () => {
    const db = rulesEnv.authenticatedContext('customer-uid').firestore();
    await assertFails(setDoc(doc(db, '_smoke/client-write'), { tampered: true }));
  });

  it('denies a client upload to a staff-only storage path', async () => {
    // Product media is publicly *readable* — it is catalogue imagery on the
    // storefront's critical path — so the wiring assertion has to be about a write,
    // and about a path the full ruleset denies. `infra/tests/storage-rules.test.ts`
    // covers the storage matrix properly; this only proves the rules file is loaded.
    const storage = rulesEnv.authenticatedContext('customer-uid').storage();

    await assertFails(
      uploadBytes(ref(storage, 'products/some-product/photo.jpg'), new Uint8Array([1, 2, 3])),
    );
  });

  it('denies a client reading an unmatched storage path', async () => {
    const storage = rulesEnv.authenticatedContext('customer-uid').storage();

    await assertFails(getBytes(ref(storage, 'not-a-known-prefix/anything.bin')));
  });

  it('allows a privileged context to bypass rules, as the Admin SDK does', async () => {
    // Mirrors the sharpest consequence of ADR-0001: server code is not
    // protected by rules, so ownership filtering is the server's own job.
    await rulesEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, '_smoke/privileged'), { wrote: true });
      const snapshot = await getDoc(doc(db, '_smoke/privileged'));
      expect(snapshot.exists()).toBe(true);
    });
  });
});
