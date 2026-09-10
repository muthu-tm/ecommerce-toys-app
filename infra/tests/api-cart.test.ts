import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '@romp/api/app';
import type { RompApp } from '@romp/api/app';
import type { CartView } from '@romp/contracts';
import { aProduct, aVariant, anInventoryRecord } from '@romp/contracts/fixtures';
import { converters, createStoreContext, systemClock } from '@romp/data';
import type { StoreContext } from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import { DEMO_PROJECT_ID, requireEmulatorEndpoint } from './helpers/emulator';

/**
 * The cart API against real Auth and Firestore emulators.
 *
 * The route tests cover validation and the merge guard; the `@romp/data` suite covers the write
 * repo. This covers the wiring and the guest-cookie mechanism: a guest add plants a signed cookie
 * and the next request finds the same cart; availability and quantity ceilings are enforced through
 * the API; and a merge folds the guest cart into the account and clears the cookie.
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
  if (body.idToken === undefined)
    throw new Error(`Emulator sign-in failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

async function seedCatalogue(productId: string, variantId: string, available = 10): Promise<void> {
  await ctx.db
    .doc(`products/${productId}`)
    .withConverter(converters.products)
    .set(aProduct({ slug: productId as ReturnType<typeof aProduct>['slug'], status: 'active' }));
  await ctx.db
    .doc(`products/${productId}/variants/${variantId}`)
    .withConverter(converters.variants)
    .set(aVariant({ sku: variantId as ReturnType<typeof aVariant>['sku'], active: true }));
  await ctx.db
    .doc(`inventory/${variantId}`)
    .withConverter(converters.inventory)
    .set(
      anInventoryRecord({
        productId: productId as ReturnType<typeof anInventoryRecord>['productId'],
        stock: { blr: available } as ReturnType<typeof anInventoryRecord>['stock'],
        onHandTotal: available,
        reserved: 0,
        lowStockThreshold: 0,
      }),
    );
}

/** Extracts the cart cookie from a Set-Cookie header for the next request. */
function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? (setCookie[0] ?? '') : (setCookie ?? '');
  return raw.split(';')[0] ?? '';
}

beforeAll(async () => {
  adminApp = initializeApp({ projectId: DEMO_PROJECT_ID }, `api-cart-${String(Date.now())}`);
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

describe('the guest cart through the API', () => {
  it('adds a line, plants a signed cookie, and finds the same cart on the next request', async () => {
    const productId = uniqueId('cart-prod');
    const variantId = uniqueId('cart-var');
    await seedCatalogue(productId, variantId, 10);

    const added = await app.inject({
      method: 'POST',
      url: '/v1/cart/items',
      payload: { productId, variantId, qty: 2, mode: 'add' },
    });
    expect(added.statusCode).toBe(200);
    const cookie = cookieFrom(added.headers['set-cookie']);
    expect(cookie).toContain('__cart_id=');
    const addedView = added.json<CartView>();
    expect(addedView.itemCount).toBe(2);
    expect(addedView.items[0]?.inStock).toBe(true);
    expect(addedView.subtotalMinor).toBe(addedView.items[0]!.lineSubtotalMinor);

    // The next request with that cookie finds the same cart.
    const read = await app.inject({ method: 'GET', url: '/v1/cart', headers: { cookie } });
    expect(read.json<CartView>().itemCount).toBe(2);
  });

  it('refuses a quantity above available stock with a 409', async () => {
    const productId = uniqueId('cart-prod');
    const variantId = uniqueId('cart-var');
    await seedCatalogue(productId, variantId, 2);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/cart/items',
      payload: { productId, variantId, qty: 5, mode: 'add' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('INVALID_STATE_TRANSITION');
  });

  it('removes a line and toggles gift wrap', async () => {
    const productId = uniqueId('cart-prod');
    const variantId = uniqueId('cart-var');
    await seedCatalogue(productId, variantId, 10);

    const added = await app.inject({
      method: 'POST',
      url: '/v1/cart/items',
      payload: { productId, variantId, qty: 1, mode: 'add' },
    });
    const cookie = cookieFrom(added.headers['set-cookie']);

    const wrapped = await app.inject({
      method: 'PATCH',
      url: '/v1/cart',
      headers: { cookie },
      payload: { giftWrap: true },
    });
    expect(wrapped.json<CartView>().giftWrap).toBe(true);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/cart/items/${variantId}`,
      headers: { cookie },
    });
    expect(removed.json<CartView>().itemCount).toBe(0);
  });
});

describe('merge on sign-in', () => {
  it('folds the guest cart into the account and clears the cookie', async () => {
    const productId = uniqueId('cart-prod');
    const variantId = uniqueId('cart-var');
    await seedCatalogue(productId, variantId, 10);

    // Guest adds two.
    const guestAdd = await app.inject({
      method: 'POST',
      url: '/v1/cart/items',
      payload: { productId, variantId, qty: 2, mode: 'add' },
    });
    const cookie = cookieFrom(guestAdd.headers['set-cookie']);

    // A customer signs in.
    const email = `cart.${String(Date.now())}@example.com`;
    const password = 'velvet thunder maple orbit river';
    const user = await getAuth(adminApp).createUser({ email, password });
    const token = await signIn(email, password);

    // The signed-in customer adds one to their own cart.
    await app.inject({
      method: 'POST',
      url: '/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { productId, variantId, qty: 1, mode: 'add' },
    });

    // Merge folds the guest cart's 2 into the user's 1 = 3.
    const merged = await app.inject({
      method: 'POST',
      url: '/v1/cart/merge',
      headers: { authorization: `Bearer ${token}`, cookie },
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json<CartView>().itemCount).toBe(3);
    // The guest cookie is cleared.
    expect(cookieFrom(merged.headers['set-cookie'])).toContain('__cart_id=');

    // The guest cart document is gone.
    const guestCartId = cookie.split('=')[1]?.split('.')[0] ?? '';
    const guestDoc = await ctx.db.doc(`carts/${guestCartId}`).get();
    expect(guestDoc.exists).toBe(false);

    // The user cart holds the merged quantity.
    expect((await ctx.db.doc(`carts/${user.uid}`).get()).exists).toBe(true);
  });
});
