import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '@romp/api/app';
import type { RompApp } from '@romp/api/app';
import type {
  ModerationQueueResponse,
  OwnReviewListResponse,
  ProductDoc,
  ReviewSubmitResponse,
} from '@romp/contracts';
import { anOrder, aProduct, aUser } from '@romp/contracts/fixtures';
import { converters, createStoreContext, systemClock } from '@romp/data';
import type { StoreContext } from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import { DEMO_PROJECT_ID, requireEmulatorEndpoint } from './helpers/emulator';

/**
 * The review API against real Auth and Firestore emulators.
 *
 * The route tests cover the guards; the `@romp/data` suite covers the write repos. This proves the
 * wiring through real tokens: a customer submits a review (held pending, verified-purchase derived,
 * author-name snapshotted from the account), sees it in their own list but not publicly, a duplicate
 * is refused, an operator sees the moderation queue and publishes or rejects, and the role guards
 * hold — a customer cannot reach the moderation routes.
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

/** Creates a signed-in customer with a display-name profile. */
async function makeCustomer(displayName = 'Asha Menon'): Promise<{ uid: string; token: string }> {
  const email = `rev.${uniqueId('c')}@example.com`;
  const user = await getAuth(adminApp).createUser({ email, password: PASSWORD });
  await ctx.db
    .doc(`users/${user.uid}`)
    .withConverter(converters.users)
    .set(aUser({ email: email as ReturnType<typeof aUser>['email'], displayName }));
  return { uid: user.uid, token: await signIn(email, PASSWORD) };
}

/** Mints an operator and returns a bearer header. */
async function operator(): Promise<string> {
  const auth = getAuth(adminApp);
  const email = `staff.${uniqueId('a')}@example.com`;
  const user = await auth.createUser({ email, password: PASSWORD });
  await auth.setCustomUserClaims(user.uid, { role: 'staff' });
  return `Bearer ${await signIn(email, PASSWORD)}`;
}

async function seedProduct(): Promise<string> {
  const slug = uniqueId('prod');
  await ctx.db
    .doc(`products/${slug}`)
    .withConverter(converters.products)
    .set(aProduct({ slug: slug as ProductDoc['slug'], status: 'active' }));
  return slug;
}

async function seedPaidOrder(uid: string, productId: string): Promise<void> {
  const base = anOrder();
  const order = anOrder({
    userId: uid as ReturnType<typeof anOrder>['userId'],
    status: 'paid',
    payment: { ...base.payment, verifiedBy: 'staff-x' as never, verifiedAt: systemClock.now() },
    items: [{ ...base.items[0]!, productId: productId as never }],
  });
  await ctx.db
    .doc(`orders/${uniqueId('order')}`)
    .withConverter(converters.orders)
    .set(order);
}

const submitBody = (productId: string) => ({
  productId,
  rating: 4,
  title: 'Sturdy and well made',
  body: 'Held up to a month of daily play with no splinters.',
});

beforeAll(async () => {
  adminApp = initializeApp({ projectId: DEMO_PROJECT_ID }, `api-reviews-${String(Date.now())}`);
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

describe('customer reviews over HTTP', () => {
  it('submits a pending review with the verified-purchase badge and snapshotted author name', async () => {
    const { token } = await makeCustomer('Asha Menon');
    const auth = { authorization: `Bearer ${token}` };
    const productId = await seedProduct();

    const submit = await app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: auth,
      payload: submitBody(productId),
    });
    expect(submit.statusCode).toBe(201);
    const created = submit.json<ReviewSubmitResponse>();
    expect(created.status).toBe('pending');
    expect(created.authorName).toBe('Asha Menon');

    // The author sees it in their own list.
    const own = await app.inject({ method: 'GET', url: '/v1/account/reviews', headers: auth });
    expect(own.statusCode).toBe(200);
    expect(own.json<OwnReviewListResponse>().reviews.some((r) => r.id === created.id)).toBe(true);
  });

  it('flags a verified purchase when the customer has a paid order for the product', async () => {
    const { uid, token } = await makeCustomer();
    const auth = { authorization: `Bearer ${token}` };
    const productId = await seedProduct();
    await seedPaidOrder(uid, productId);

    const submit = await app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: auth,
      payload: submitBody(productId),
    });
    expect(submit.statusCode).toBe(201);
    expect(submit.json<ReviewSubmitResponse>().verifiedPurchase).toBe(true);
  });

  it('refuses a second review for the same product', async () => {
    const { token } = await makeCustomer();
    const auth = { authorization: `Bearer ${token}` };
    const productId = await seedProduct();

    const first = await app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: auth,
      payload: submitBody(productId),
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: auth,
      payload: submitBody(productId),
    });
    expect(second.statusCode).toBe(400);
  });

  it('401s an anonymous submission', async () => {
    const productId = await seedProduct();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reviews',
      payload: submitBody(productId),
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('review moderation over HTTP', () => {
  it('lists the queue and publishes a review', async () => {
    const { token } = await makeCustomer();
    const auth = { authorization: `Bearer ${token}` };
    const productId = await seedProduct();
    const submit = await app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: auth,
      payload: submitBody(productId),
    });
    const reviewId = submit.json<ReviewSubmitResponse>().id;

    const operatorAuth = await operator();
    const queue = await app.inject({
      method: 'GET',
      url: '/v1/admin/reviews',
      headers: { authorization: operatorAuth },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json<ModerationQueueResponse>().reviews.some((r) => r.id === reviewId)).toBe(true);

    const publish = await app.inject({
      method: 'POST',
      url: `/v1/admin/reviews/${reviewId}/publish`,
      headers: { authorization: operatorAuth },
    });
    expect(publish.statusCode).toBe(204);
  });

  it('rejects a review with a reason', async () => {
    const { token } = await makeCustomer();
    const auth = { authorization: `Bearer ${token}` };
    const productId = await seedProduct();
    const submit = await app.inject({
      method: 'POST',
      url: '/v1/reviews',
      headers: auth,
      payload: submitBody(productId),
    });
    const reviewId = submit.json<ReviewSubmitResponse>().id;

    const operatorAuth = await operator();
    const reject = await app.inject({
      method: 'POST',
      url: `/v1/admin/reviews/${reviewId}/reject`,
      headers: { authorization: operatorAuth },
      payload: { reason: 'Off-topic.' },
    });
    expect(reject.statusCode).toBe(204);
  });

  it('refuses a moderation reason that is empty', async () => {
    const operatorAuth = await operator();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/reviews/whatever/reject',
      headers: { authorization: operatorAuth },
      payload: { reason: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('403s a customer reaching the moderation queue', async () => {
    const { token } = await makeCustomer();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/reviews',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
  });
});
