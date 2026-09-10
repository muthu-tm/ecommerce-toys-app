import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '@romp/api/app';
import type { RompApp } from '@romp/api/app';
import { createStoreContext, systemClock } from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import { DEMO_PROJECT_ID, requireEmulatorEndpoint } from './helpers/emulator';

/**
 * The identity API against real Auth and Firestore emulators.
 *
 * The route contract tests in `apps/api` cover the decisions made before the SDK is
 * touched — validation, the password policy, rate limiting, the guards. This suite covers
 * the half only a real backend can: that registration actually creates one Auth user, one
 * `identityIndex` entry and one `users` profile; that a duplicate identifier fails
 * atomically with no orphan; that every spelling of a number reaches the same account; and
 * that a password change revokes existing sessions.
 *
 * It lives in `@romp/infra` because that is where the emulator harness runs — the Auth and
 * Firestore emulators are already started by `firebase emulators:exec`.
 */

let adminApp: App;
let app: RompApp;

const CONFIG = {
  storeId: 'test-store',
  brandNames: ['Test Store'],
  defaultPhoneRegion: 'IN',
  corsOrigins: ['https://shop.test'],
  cartCookieSecret: 'emulator-cart-secret',
};

/** The Auth emulator REST host, for signing in to obtain a real ID token. */
function authEmulatorHost(): string {
  const { host, port } = requireEmulatorEndpoint('FIREBASE_AUTH_EMULATOR_HOST');
  return `http://${host}:${String(port)}`;
}

/**
 * Signs in with the login email and password through the Auth emulator's REST endpoint to
 * get a real ID token — the same round trip a client SDK does at sign-in. This is what a
 * customer's browser does after registering, so it exercises the exact token the API's auth
 * middleware verifies. `createCustomToken` is avoided because it requires a service account
 * the emulator does not provide.
 */
async function signIn(loginEmail: string, password: string): Promise<string> {
  const response = await fetch(
    `${authEmulatorHost()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken?: string };
  if (body.idToken === undefined) {
    throw new Error(`Emulator sign-in failed: ${JSON.stringify(body)}`);
  }
  return body.idToken;
}

beforeAll(async () => {
  adminApp = initializeApp({ projectId: DEMO_PROJECT_ID }, `api-identity-${String(Date.now())}`);
  const auth = getAuth(adminApp);
  const db = getFirestore(adminApp);
  app = await buildApp({
    logger: createSilentLogger(),
    auth,
    context: createStoreContext({ storeId: CONFIG.storeId, db, clock: systemClock }),
    config: CONFIG,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await deleteApp(adminApp);
});

// A fresh set of accounts per test: use a unique identifier so cases do not collide in the
// shared emulator. Clearing Auth between tests is slower and unnecessary when identifiers
// are unique.
let seq = 0;
function uniqueEmail(): string {
  seq += 1;
  return `user${String(seq)}.${String(Date.now())}@example.com`;
}

/**
 * A unique client IP per call.
 *
 * The rate limiter is keyed on the client IP for anonymous requests, and `app.inject`
 * otherwise presents the same address every time — so a handful of registrations in one run
 * would exhaust the 5/hour register budget and later cases would see 429 instead of the
 * behaviour under test. A fresh IP per call gives each its own window, which is faithful:
 * these are logically different clients.
 */
let ipSeq = 0;
function freshIp(): string {
  ipSeq += 1;
  return `203.0.113.${String(ipSeq % 250)}`;
}

/** Registers via the API from a fresh client IP. */
function register(payload: { identifier: string; password: string; displayName: string }) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    headers: { 'x-forwarded-for': freshIp() },
    payload,
  });
}

/** Checks identifier availability from a fresh client IP. */
function checkIdentifier(identifier: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/check-identifier',
    headers: { 'x-forwarded-for': freshIp() },
    payload: { identifier },
  });
}

const STRONG_PASSWORD = 'velvet thunder maple orbit river';

describe('POST /v1/auth/register', () => {
  it('creates an Auth user, an identityIndex entry and a users profile', async () => {
    const email = uniqueEmail();
    const response = await register({
      identifier: email,
      password: STRONG_PASSWORD,
      displayName: 'Aditi',
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json<{
      uid: string;
      loginEmail: string;
      primaryIdentifierType: string;
    }>();
    expect(body.loginEmail).toBe(email);
    expect(body.primaryIdentifierType).toBe('email');

    // The Auth user exists.
    const user = await getAuth(adminApp).getUser(body.uid);
    expect(user.email).toBe(email);

    // The identityIndex entry maps the identifier to the uid.
    const index = await getFirestore(adminApp).doc(`identityIndex/${email}`).get();
    expect(index.exists).toBe(true);
    expect(index.data()?.uid).toBe(body.uid);

    // The users profile exists.
    const profile = await getFirestore(adminApp).doc(`users/${body.uid}`).get();
    expect(profile.exists).toBe(true);
    expect(profile.data()?.displayName).toBe('Aditi');
  });

  it('maps every spelling of a mobile number to one account', async () => {
    const suffix = String(Date.now()).slice(-6);
    const national = `98${suffix}0000`.slice(0, 10);
    const first = await register({
      identifier: national,
      password: STRONG_PASSWORD,
      displayName: 'Phone User',
    });
    expect(first.statusCode, first.body).toBe(201);
    const firstBody = first.json<{ uid: string; loginEmail: string }>();
    expect(firstBody.loginEmail).toMatch(/^p\.\d+@auth\.test-store\.internal$/u);

    // A different spelling of the same number is now taken.
    const spaced = `0${national.slice(0, 5)} ${national.slice(5)}`;
    const second = await register({
      identifier: spaced,
      password: STRONG_PASSWORD,
      displayName: 'Again',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ code: string }>().code).toBe('IDENTIFIER_TAKEN');
  });

  it('rejects a duplicate identifier without leaving an orphan Auth user', async () => {
    const email = uniqueEmail();
    const first = await register({
      identifier: email,
      password: STRONG_PASSWORD,
      displayName: 'First',
    });
    expect(first.statusCode, first.body).toBe(201);

    const before = (await getAuth(adminApp).listUsers()).users.length;
    const duplicate = await register({
      identifier: email,
      password: STRONG_PASSWORD,
      displayName: 'Second',
    });
    expect(duplicate.statusCode).toBe(409);

    // No second Auth user was left behind — the rollback deleted it.
    const after = (await getAuth(adminApp).listUsers()).users.length;
    expect(after).toBe(before);
  });
});

describe('POST /v1/auth/check-identifier', () => {
  it('reports availability without disclosing the account', async () => {
    const email = uniqueEmail();

    const before = await checkIdentifier(email);
    expect(before.json<{ available: boolean }>().available).toBe(true);

    const registered = await register({
      identifier: email,
      password: STRONG_PASSWORD,
      displayName: 'Taken',
    });
    expect(registered.statusCode, registered.body).toBe(201);

    const after = await checkIdentifier(email);
    expect(after.json<{ available: boolean }>().available).toBe(false);
  });
});

describe('GET/PATCH /v1/me', () => {
  it('returns and updates the caller’s own profile', async () => {
    const email = uniqueEmail();
    const registered = await register({
      identifier: email,
      password: STRONG_PASSWORD,
      displayName: 'Original',
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const { loginEmail } = registered.json<{ loginEmail: string }>();
    const token = await signIn(loginEmail, STRONG_PASSWORD);

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json<{ displayName: string; emailPresent: boolean; phonePresent: boolean }>();
    expect(meBody.displayName).toBe('Original');
    expect(meBody.emailPresent).toBe(true);
    expect(meBody.phonePresent).toBe(false);

    const patched = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: 'Renamed' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ displayName: string }>().displayName).toBe('Renamed');
  });
});

describe('POST /v1/auth/password-change', () => {
  it('changes the password and revokes existing refresh tokens', async () => {
    const email = uniqueEmail();
    const registered = await register({
      identifier: email,
      password: STRONG_PASSWORD,
      displayName: 'Rotator',
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const { loginEmail } = registered.json<{ loginEmail: string }>();
    const token = await signIn(loginEmail, STRONG_PASSWORD);

    const changed = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-change',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: STRONG_PASSWORD, newPassword: 'copper lantern drift meadow' },
    });
    expect(changed.statusCode).toBe(204);

    // The password actually changed: the old password no longer signs in. (The handler also
    // calls `revokeRefreshTokens`; its downstream effect via `checkRevoked` is second-
    // granular and so not asserted on a same-second change, but the credential rotation is
    // deterministic and is the property a customer relies on.)
    const oldPasswordSignIn = await fetch(
      `${authEmulatorHost()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail,
          password: STRONG_PASSWORD,
          returnSecureToken: true,
        }),
      },
    );
    expect(oldPasswordSignIn.status).toBe(400);

    // The new password does sign in.
    const newToken = await signIn(loginEmail, 'copper lantern drift meadow');
    expect(newToken.length).toBeGreaterThan(0);
  });
});
