'use client';

import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';

import { clientApp } from './firebase-client';
import { connectAuthToEmulator } from './firebase-emulator';

/**
 * The operator's authentication, for calling the API and Storage as themselves.
 *
 * The backoffice's writes go through the API, which verifies a Firebase ID token carrying the
 * `owner`/`staff` role claim. This is the seam that produces that token. Full sign-in — the
 * login screen, session persistence, the role-claim gate on the whole app — is Task 20; until
 * then this returns null when no client auth is configured, and the UI renders its
 * signed-out state, exactly as the storefront's notification bell does.
 *
 * Coverage-excluded: it is browser-SDK glue that aborts a jsdom worker on import. The pure
 * request-building it feeds (`product-form.ts`, `api.ts`'s path builders) is tested directly.
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
 * Null is the honest v1.0 state before client auth exists (Task 20): the write controls
 * disable themselves and explain that sign-in is required, rather than firing an
 * unauthenticated request the API would reject with a 401.
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
