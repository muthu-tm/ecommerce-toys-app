'use client';

import {
  type Auth,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

import { classifyIdentifier, normalizeEmail, normalizePhone, toAuthEmail } from '@romp/core';

import { clientApp } from './firebase-client';
import { connectAuthToEmulator } from './firebase-emulator';

/**
 * The operator's authentication.
 *
 * The backoffice's writes go through the API, which verifies a Firebase ID token carrying the
 * `owner`/`staff` role claim. This module produces that token, and now also owns operator
 * sign-in and sign-out: the backoffice is a **login-only** surface (admins are seeded, never
 * self-registered — `docs/IDENTITY.md`), so there is a sign-in form and no register flow.
 *
 * Sign-in reuses the exact `@romp/core` identifier helpers the storefront and the server use,
 * so an operator can sign in with an email or a mobile number and the derived login alias
 * matches the seeded account. Whether that account actually carries the operator claim is
 * decided server-side — the guard checks `GET /v1/admin/me` — so a signed-in customer without
 * the claim is refused with a clear message rather than silently let in.
 *
 * Coverage-excluded: browser-SDK glue that aborts a jsdom worker on import. The pure
 * request-building it feeds (`product-form.ts`, `api.ts`'s path builders) and the identifier
 * normalisation (`@romp/core`) are tested directly.
 */

let auth: Auth | null = null;

/** The client Auth instance, or null when the SDK is not configured. */
function authClient(): Auth | null {
  if (auth !== null) return auth;
  const app = clientApp();
  if (app === null) return null;
  auth = getAuth(app);
  // In emulator mode, point Auth at the local emulator — once, before any sign-in. A no-op
  // when the flag is off, so production is untouched.
  connectAuthToEmulator(auth, (instance, url, options) => {
    connectAuthEmulator(instance as Auth, url, options);
  });
  return auth;
}

/**
 * The current operator's ID token, or null when nobody is signed in.
 *
 * Attached as the bearer on every backoffice API write. Null when signed out, so `api.ts`
 * fails fast with a "sign in" message rather than firing an unauthenticated request.
 */
export async function operatorToken(): Promise<string | null> {
  const client = authClient();
  const user = client?.currentUser ?? null;
  if (user === null) return null;
  return user.getIdToken();
}

/** Whether an operator is signed in right now. */
export function isSignedIn(): boolean {
  return authClient()?.currentUser != null;
}

/** Whether client auth is configured — false in a build with no web config. */
export function authConfigured(): boolean {
  return clientApp() !== null;
}

/**
 * Signs an operator in with an email or a mobile number and a password.
 *
 * The identifier is classified and normalised with the **same** `@romp/core` helpers the seed
 * script used when it minted the admin account, so the login alias derived here matches the
 * Auth account exactly: an email lowercases and trims, a mobile becomes the internal
 * `p.<e164>@auth.<store>.internal` alias. Firebase then verifies the password. Whether the
 * account carries the operator claim is not checked here — that is the guard's job.
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

/** Signs the operator out. A no-op when the SDK is unconfigured. */
export async function signOutOperator(): Promise<void> {
  const client = authClient();
  if (client === null) return;
  await signOut(client);
}

/**
 * Subscribes to sign-in changes, invoking `listener` with the current uid (or null) now and on
 * every change. Returns an unsubscribe. A no-op returning a no-op when the SDK is unconfigured,
 * so the auth context can wire it unconditionally and see "signed out" until auth is set up.
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
