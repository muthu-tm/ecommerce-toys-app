import { type App, getApps, initializeApp } from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';
// eslint-disable-next-line no-restricted-imports -- the bootstrap is the one place that constructs the Firestore value; it is handed to @romp/data as a StoreContext and never queried here.
import { type Firestore, getFirestore } from 'firebase-admin/firestore';

/**
 * Admin SDK bootstrap for the API.
 *
 * The API holds the Auth Admin SDK because identity has no repository to route through —
 * the Auth service *is* the datastore for users. Firestore access still goes through
 * `@romp/data` repositories, which take an injected `Firestore` instance; this module owns
 * only the singleton `App` and the `Auth` client on top of it.
 *
 * Emulator-aware without any code here: `firebase-admin` reads `FIREBASE_AUTH_EMULATOR_HOST`
 * and `FIRESTORE_EMULATOR_HOST` from the environment when they are set, so a test or a local
 * run against the emulator needs no credentials and no branching. In production the SDK
 * picks up Application Default Credentials from the Cloud Functions runtime.
 */

let app: App | undefined;

/** The memoised Admin SDK app, created once per process. */
export function adminApp(): App {
  if (app !== undefined) return app;
  // Reuse an app the Functions runtime may already have initialised, rather than throwing
  // on a duplicate.
  app = getApps()[0] ?? initializeApp();
  return app;
}

let authClient: Auth | undefined;

/** The memoised Auth client. */
export function auth(): Auth {
  authClient ??= getAuth(adminApp());
  return authClient;
}

let firestoreClient: Firestore | undefined;

/**
 * The memoised Firestore client.
 *
 * Handed to `@romp/data`'s `createStoreContext` and never queried directly — the data
 * package is the only place a query is built. This is the sole reason the API touches
 * `firebase-admin/firestore` at all, which is why the import is a scoped exception rather
 * than an app-wide allowance.
 */
export function db(): Firestore {
  firestoreClient ??= getFirestore(adminApp());
  return firestoreClient;
}

/**
 * Resets the memoised singletons.
 *
 * For tests only — a test that points the SDK at a fresh emulator project between cases
 * needs the next accessor call to rebuild against it rather than returning a stale client.
 */
export function resetFirebaseForTest(): void {
  app = undefined;
  authClient = undefined;
  firestoreClient = undefined;
}
