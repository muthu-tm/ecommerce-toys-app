import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '@romp/api/app';
import type { RompApp } from '@romp/api/app';
import type { AddressView, OrderListResponse } from '@romp/contracts';
import { aProduct, aUser } from '@romp/contracts/fixtures';
import { converters, createStoreContext, systemClock } from '@romp/data';
import type { StoreContext } from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import { DEMO_PROJECT_ID, requireEmulatorEndpoint } from './helpers/emulator';

/**
 * The account API against real Auth and Firestore emulators.
 *
 * The route tests cover the guards and validation, and the `@romp/data` suite covers the write repos.
 * This proves the wiring through a real signed-in token: address CRUD holds the single-default
 * invariant, the wishlist toggle round-trips, the order history returns the caller's own orders, and
 * a password change appends the account-security event that reaches the customer's own feed.
 */

let adminApp: App;
let app: RompApp;
let ctx: StoreContext;

const CONFIG = {
  storeId: 'test-store',
  brandNames: ['Test Store'],
  defaultPhoneRegion: 'IN',
  corsOrigins: ['https://shop.test'],
  cartCookieSecret: 'emulator-cart-secret',
};

function authEmulatorHost(): string {
  const { host, port } = requireEmulatorEndpoint('FIREBASE_AUTH_EMULATOR_HOST');
  return `http://${host}:${String(port)}`;
}

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
  if (body.idToken === undefined) throw new Error(`Sign-in failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

const PASSWORD = 'velvet thunder maple orbit river';

/** Creates a signed-in customer with a profile. Returns the uid and a bearer token. */
async function makeCustomer(): Promise<{ uid: string; token: string }> {
  const email = `acct.${uniqueId('c')}@example.com`;
  const user = await getAuth(adminApp).createUser({ email, password: PASSWORD });
  await ctx.db
    .doc(`users/${user.uid}`)
    .withConverter(converters.users)
    .set(aUser({ email: email as ReturnType<typeof aUser>['email'] }));
  return { uid: user.uid, token: await signIn(email, PASSWORD) };
}

const address = (label: string, isDefault: boolean) => ({
  label,
  recipientName: 'Asha Menon',
  line1: '12 Palm Grove',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  phone: '+919845021174',
  isDefault,
});

beforeAll(async () => {
  adminApp = initializeApp({ projectId: DEMO_PROJECT_ID }, `api-account-${String(Date.now())}`);
  ctx = createStoreContext({
    storeId: CONFIG.storeId,
    db: getFirestore(adminApp),
    clock: systemClock,
  });
  app = await buildApp({
    logger: createSilentLogger(),
    auth: getAuth(adminApp),
    context: ctx,
    config: CONFIG,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await deleteApp(adminApp);
});

describe('address CRUD over HTTP', () => {
  it('creates, promotes and refuses deleting the default', async () => {
    const { token } = await makeCustomer();
    const auth = { authorization: `Bearer ${token}` };

    const home = await app.inject({
      method: 'POST',
      url: '/v1/addresses',
      headers: auth,
      payload: address('Home', false),
    });
    expect(home.statusCode).toBe(201);
    // First address is the default even though not requested.
    expect(home.json<AddressView>().isDefault).toBe(true);
    const homeId = home.json<AddressView>().id;

    const office = await app.inject({
      method: 'POST',
      url: '/v1/addresses',
      headers: auth,
      payload: address('Office', true),
    });
    expect(office.statusCode).toBe(201);
    const officeId = office.json<AddressView>().id;

    // Deleting the default (office) while home exists is refused.
    const refuse = await app.inject({
      method: 'DELETE',
      url: `/v1/addresses/${officeId}`,
      headers: auth,
    });
    expect(refuse.statusCode).toBe(400);

    // Promote home back, then office can be deleted.
    const promote = await app.inject({
      method: 'PATCH',
      url: `/v1/addresses/${homeId}`,
      headers: auth,
      payload: { isDefault: true },
    });
    expect(promote.statusCode).toBe(204);
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/addresses/${officeId}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
  });

  it('appends an account.address_added event on create', async () => {
    const { uid, token } = await makeCustomer();
    await app.inject({
      method: 'POST',
      url: '/v1/addresses',
      headers: { authorization: `Bearer ${token}` },
      payload: address('Home', true),
    });

    const events = await ctx.db
      .collection('events')
      .where('type', '==', 'account.address_added')
      .where('subject.id', '==', uid)
      .get();
    expect(events.empty).toBe(false);
  });
});

describe('wishlist over HTTP', () => {
  it('adds and removes a product', async () => {
    const { token } = await makeCustomer();
    const auth = { authorization: `Bearer ${token}` };
    const productId = uniqueId('prod');
    await ctx.db
      .doc(`products/${productId}`)
      .withConverter(converters.products)
      .set(aProduct({ slug: productId as ReturnType<typeof aProduct>['slug'], status: 'active' }));

    const add = await app.inject({
      method: 'PUT',
      url: `/v1/wishlist/${productId}`,
      headers: auth,
    });
    expect(add.statusCode).toBe(204);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/v1/wishlist/${productId}`,
      headers: auth,
    });
    expect(remove.statusCode).toBe(204);
  });

  it('404s adding a product that does not exist', async () => {
    const { token } = await makeCustomer();
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/wishlist/no-such-product',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('order history over HTTP', () => {
  it('returns the caller’s own orders, empty when none', async () => {
    const { token } = await makeCustomer();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/orders',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<OrderListResponse>().orders).toEqual([]);
  });
});

describe('password change over HTTP', () => {
  it('changes the password and appends the account.password_changed event', async () => {
    const { uid, token } = await makeCustomer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-change',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: PASSWORD, newPassword: 'copper lantern drift meadow stone' },
    });
    expect(response.statusCode).toBe(204);

    const events = await ctx.db
      .collection('events')
      .where('type', '==', 'account.password_changed')
      .where('subject.id', '==', uid)
      .get();
    expect(events.empty).toBe(false);
  });
});
