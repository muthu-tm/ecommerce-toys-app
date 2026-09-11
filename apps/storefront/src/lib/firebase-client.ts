import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { type Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

import { classifyIdentifier, normalizeEmail, normalizePhone, toAuthEmail } from '@romp/core';

import {
  connectAuthToEmulator,
  connectFirestoreToEmulator,
  emulatorConfig,
} from './firebase-emulator';

/**
 * The **client** Firebase SDK for the browser.
 *
 * Separate from the server data layer (`src/server/*`, Admin SDK) in every way: this runs
 * in the browser, reads under security rules, and holds only the public web config. It
 * exists for the two things a page cannot do server-side — a realtime `onSnapshot`
 * subscription (the notification bell) and the customer's own scoped reads/writes.
 *
 * The config is `NEXT_PUBLIC_*` because it is genuinely public: a Firebase web config is not
 * a secret — security rules, not config obscurity, are what protect the data. Absent config
 * (local dev without it, or a build with none) leaves `firestoreClient()` returning null, so
 * a feature that needs it degrades to its signed-out state rather than throwing.
 *
 * In emulator mode (`NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`) a synthetic config is used
 * instead, so local E2E needs no real Firebase project: the emulator ignores the API key and
 * app ID entirely, and the connect calls in the getters below route the SDK to the local
 * emulator. See `firebase-emulator.ts`.
 */

interface WebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
}

/**
 * A synthetic config for emulator mode. The emulator validates none of these; the project ID
 * must match the emulator's own project so the client and the seeded data share it. The
 * orchestrator sets `NEXT_PUBLIC_FIREBASE_PROJECT_ID`; the fallback derives a `demo-<store>`
 * project from the store id so nothing brand-specific is hardcoded here.
 */
function emulatorWebConfig(): WebConfig {
  const storeId = process.env.NEXT_PUBLIC_STORE_ID ?? 'store';
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? `demo-${storeId}`;
  return {
    apiKey: 'emulator-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: 'emulator-app-id',
  };
}

/** Reads the web config from the environment, or null when it is not configured. */
function webConfig(): WebConfig | null {
  // Emulator mode does not need a real web config — the emulator ignores it — so a synthetic
  // one keeps `clientApp()` non-null and lets the connect calls take over.
  if (emulatorConfig().enabled) return emulatorWebConfig();

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  if (
    apiKey === undefined ||
    projectId === undefined ||
    appId === undefined ||
    authDomain === undefined
  ) {
    return null;
  }
  return { apiKey, authDomain, projectId, appId };
}

let app: FirebaseApp | undefined;

/** The memoised client app, or null when no web config is present. */
export function clientApp(): FirebaseApp | null {
  if (app !== undefined) return app;
  const config = webConfig();
  if (config === null) return null;
  app = getApps()[0] ?? initializeApp(config);
  return app;
}

let db: Firestore | undefined;

/**
 * The memoised client Firestore, or null when the SDK is not configured.
 *
 * Callers must handle null: it is the honest state of a store before its web config is
 * wired, and it keeps the notification bell rendering its signed-out affordance rather than
 * crashing.
 */
export function firestoreClient(): Firestore | null {
  if (db !== undefined) return db;
  const configured = clientApp();
  if (configured === null) return null;
  db = getFirestore(configured);
  // In emulator mode, point this Firestore at the local emulator — once, before any read.
  // A no-op when the flag is off, so production is untouched.
  connectFirestoreToEmulator(db, (instance, host, port) => {
    connectFirestoreEmulator(instance as Firestore, host, port);
  });
  return db;
}

let auth: Auth | undefined;

/**
 * The memoised client Auth, or null when the SDK is not configured.
 *
 * Centralised so the emulator connect happens exactly once, before any sign-in: the Auth SDK
 * throws if `connectAuthEmulator` runs twice, so every `getAuth` call site in this module
 * goes through here rather than calling `getAuth` directly. A no-op wiring when the flag is
 * off leaves the real Firebase Auth in place.
 */
function authClient(): Auth | null {
  if (auth !== undefined) return auth;
  const configured = clientApp();
  if (configured === null) return null;
  auth = getAuth(configured);
  connectAuthToEmulator(auth, (instance, url, options) => {
    connectAuthEmulator(instance as Auth, url, options);
  });
  return auth;
}

/**
 * The signed-in customer's Firebase ID token, or null when nobody is signed in.
 *
 * The API's protected routes — the checkout quote and order placement — verify a bearer ID token
 * on every request, so a client that writes through them must attach a fresh one. `getIdToken`
 * returns the cached token and refreshes it transparently when it is close to expiry, so callers do
 * not manage token lifetime themselves. Returns null when the SDK is unconfigured or no user is
 * signed in, which lets the checkout page render its signed-out affordance rather than throwing —
 * the same graceful-degradation contract the rest of this module keeps until client auth (Task 20)
 * gives the storefront a real sign-in surface.
 */
export async function idToken(): Promise<string | null> {
  const client = authClient();
  if (client === null) return null;
  const { currentUser } = client;
  if (currentUser === null) return null;
  return currentUser.getIdToken();
}

/** The signed-in customer's uid, or null. Used to scope the customer's own client reads. */
export function currentUid(): string | null {
  const client = authClient();
  if (client === null) return null;
  return client.currentUser?.uid ?? null;
}

/**
 * Subscribes to sign-in changes, invoking `listener` with the current uid (or null) now and on
 * every change. Returns an unsubscribe. A no-op returning a no-op when the SDK is unconfigured, so
 * a component effect can wire it unconditionally and simply see "signed out" until auth is set up.
 */
export function onUidChanged(listener: (uid: string | null) => void): () => void {
  const client = authClient();
  if (client === null) {
    listener(null);
    return () => {
      /* nothing to unsubscribe */
    };
  }
  return onAuthStateChanged(client, (user) => {
    listener(user?.uid ?? null);
  });
}

/** Whether client auth is configured — false in a build with no web config. */
export function authConfigured(): boolean {
  return clientApp() !== null;
}

/**
 * Signs a customer in with an email or a mobile number and a password.
 *
 * The identifier is whatever they typed — an email or a phone in any spelling. It is classified and
 * normalised with the **same** `@romp/core` helpers the server used at registration, so the login
 * alias derived here matches the Auth account exactly: an email lowercases and trims, a mobile
 * becomes the internal `p.<e164>@auth.<store>.internal` alias. Firebase then verifies the password.
 *
 * `storeId` and `defaultRegion` come from the store config the caller holds — a mobile alias is
 * store-scoped, and a bare 10-digit number needs a region to become E.164.
 */
export async function signInWithIdentifier(
  identifier: string,
  password: string,
  options: { readonly storeId: string; readonly defaultRegion: string },
): Promise<void> {
  const client = authClient();
  if (client === null) {
    throw new Error('Sign-in is not available: the store’s web config is not set.');
  }

  const loginEmail =
    classifyIdentifier(identifier) === 'email'
      ? normalizeEmail(identifier)
      : toAuthEmail(normalizePhone(identifier, options.defaultRegion), options.storeId);

  await signInWithEmailAndPassword(client, loginEmail, password);
}

/**
 * Signs the customer out.
 *
 * `IDENTITY.md § sessions`: sign-out clears the session and detaches Firestore listeners. The
 * listener teardown is owned by each subscription (the notification bell tears its `onSnapshot` down
 * when the uid goes null), so here it is enough to end the Auth session — `onUidChanged` then fires
 * `null` and every subscription unwinds.
 */
export async function signOutCustomer(): Promise<void> {
  const client = authClient();
  if (client === null) return;
  await signOut(client);
}
