import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '@romp/api/app';
import type { RompApp } from '@romp/api/app';
import { converters, createStoreContext, getDocument, systemClock } from '@romp/data';
import type { StoreContext } from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import { DEMO_PROJECT_ID, requireEmulatorEndpoint } from './helpers/emulator';

/**
 * The backoffice category API against real Auth and Firestore emulators.
 *
 * The route tests in `apps/api` cover the pre-Firestore decisions and the `@romp/data` suite
 * covers the write repository; this covers the wiring between them: an operator's HTTP request
 * creates a category, a duplicate slug is a 409, and a delete is refused while a child still
 * depends on it — end to end through the API with a real operator token.
 */

let adminApp: App;
let app: RompApp;
let ctx: StoreContext;

const CONFIG = {
  storeId: 'test-store',
  brandNames: ['Test Store'],
  defaultPhoneRegion: 'IN',
  corsOrigins: ['https://admin.test'],
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
  if (body.idToken === undefined) {
    throw new Error(`Emulator sign-in failed: ${JSON.stringify(body)}`);
  }
  return body.idToken;
}

let operatorAuth = '';

beforeAll(async () => {
  adminApp = initializeApp({ projectId: DEMO_PROJECT_ID }, `api-categories-${String(Date.now())}`);
  const auth = getAuth(adminApp);
  const db = getFirestore(adminApp);
  ctx = createStoreContext({ storeId: CONFIG.storeId, db, clock: systemClock });

  app = await buildApp({ logger: createSilentLogger(), auth, context: ctx, config: CONFIG });
  await app.ready();

  const email = `cat.admin.${String(Date.now())}@example.com`;
  const password = 'velvet thunder maple orbit river';
  const user = await auth.createUser({ email, password });
  await auth.setCustomUserClaims(user.uid, { role: 'owner' });
  operatorAuth = `Bearer ${await signIn(email, password)}`;
});

afterAll(async () => {
  await app.close();
  await deleteApp(adminApp);
});

const AUTH = () => ({ authorization: operatorAuth });

const uniqueSlug = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

const createBody = (slug: string, overrides: Record<string, unknown> = {}) => ({
  name: `Category ${slug}`,
  slug,
  parentId: null,
  active: true,
  showInNav: true,
  showInFilters: true,
  sortOrder: 10,
  ...overrides,
});

describe('the category lifecycle through the API', () => {
  it('creates a category with productCount seeded to zero', async () => {
    const slug = uniqueSlug('api-cat');
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH(),
      payload: createBody(slug),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<{ slug: string }>().slug).toBe(slug);

    const stored = await getDocument(ctx, `categories/${slug}`, converters.categories);
    expect(stored?.name).toBe(`Category ${slug}`);
    expect(stored?.productCount).toBe(0);
    expect(stored?.active).toBe(true);
  });

  it('409s a duplicate slug', async () => {
    const slug = uniqueSlug('api-dup');
    await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH(),
      payload: createBody(slug),
    });

    const again = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH(),
      payload: createBody(slug),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('IDENTIFIER_TAKEN');
  });

  it('edits a category and toggles activation', async () => {
    const slug = uniqueSlug('api-edit');
    await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH(),
      payload: createBody(slug),
    });

    const edit = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/categories/${slug}`,
      headers: AUTH(),
      payload: {
        name: 'Renamed',
        parentId: null,
        active: false,
        showInNav: false,
        showInFilters: true,
        sortOrder: 99,
      },
    });
    expect(edit.statusCode).toBe(204);

    const stored = await getDocument(ctx, `categories/${slug}`, converters.categories);
    expect(stored?.name).toBe('Renamed');
    expect(stored?.active).toBe(false);
    expect(stored?.sortOrder).toBe(99);
  });

  it('refuses a parent that does not exist with a 409', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH(),
      payload: createBody(uniqueSlug('api-orphan'), { parentId: 'no-such-parent' }),
    });
    expect(create.statusCode).toBe(409);
    expect(create.json<{ code: string }>().code).toBe('INVALID_STATE_TRANSITION');
  });

  it('deletes an empty category, and refuses to delete one with a child', async () => {
    const parent = uniqueSlug('api-parent');
    const child = uniqueSlug('api-child');
    await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH(),
      payload: createBody(parent),
    });
    await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH(),
      payload: createBody(child, { parentId: parent, sortOrder: 11 }),
    });

    // Parent has a child — refused.
    const blocked = await app.inject({
      method: 'DELETE',
      url: `/v1/admin/categories/${parent}`,
      headers: AUTH(),
    });
    expect(blocked.statusCode).toBe(409);

    // The child is a leaf with no products — deletes.
    const ok = await app.inject({
      method: 'DELETE',
      url: `/v1/admin/categories/${child}`,
      headers: AUTH(),
    });
    expect(ok.statusCode).toBe(204);
    expect(await getDocument(ctx, `categories/${child}`, converters.categories)).toBeNull();

    // Now the parent is childless — deletes.
    const parentDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/admin/categories/${parent}`,
      headers: AUTH(),
    });
    expect(parentDelete.statusCode).toBe(204);
  });

  it('reorders categories', async () => {
    const a = uniqueSlug('api-ord-a');
    const b = uniqueSlug('api-ord-b');
    await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH(),
      payload: createBody(a, { sortOrder: 10 }),
    });
    await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH(),
      payload: createBody(b, { sortOrder: 20 }),
    });

    const reorder = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories/reorder',
      headers: AUTH(),
      payload: {
        orders: [
          { slug: a, sortOrder: 200 },
          { slug: b, sortOrder: 100 },
        ],
      },
    });
    expect(reorder.statusCode).toBe(204);
    expect((await getDocument(ctx, `categories/${a}`, converters.categories))?.sortOrder).toBe(200);
    expect((await getDocument(ctx, `categories/${b}`, converters.categories))?.sortOrder).toBe(100);
  });
});
