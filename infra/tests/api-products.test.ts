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
 * The backoffice product API against real Auth and Firestore emulators.
 *
 * The route contract tests in `apps/api` cover the pre-Firestore decisions (guards,
 * validation); the `@romp/data` emulator suite covers the write repositories directly. This
 * covers the wiring between them: an operator's HTTP request assembles a valid document,
 * writes it, and the publish flow enforces the active-variant rule end to end through the
 * API — with a real operator ID token carrying the `owner` claim the guard verifies.
 */

let adminApp: App;
let app: RompApp;
let ctx: StoreContext;
const revalidatedTags: string[][] = [];

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
  adminApp = initializeApp({ projectId: DEMO_PROJECT_ID }, `api-products-${String(Date.now())}`);
  const auth = getAuth(adminApp);
  const db = getFirestore(adminApp);
  ctx = createStoreContext({ storeId: CONFIG.storeId, db, clock: systemClock });

  app = await buildApp({
    logger: createSilentLogger(),
    auth,
    context: ctx,
    config: CONFIG,
    // Record the tags a publish/edit would revalidate, so the seam is asserted without next.
    revalidate: (tags) => {
      revalidatedTags.push([...tags]);
      return Promise.resolve();
    },
  });
  await app.ready();

  // Mint an operator with the owner claim, then sign in for a real ID token.
  const email = `admin.${String(Date.now())}@example.com`;
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

function createBody(name: string) {
  return {
    name,
    description: 'A set of sanded beechwood blocks for building.',
    brand: 'Woodwise',
    categoryId: 'building-sets',
    categorySlug: 'building-sets',
    ageBand: '6-8',
    badge: null,
    skills: ['spatial reasoning'],
    boxItems: ['240 blocks'],
    safety: {
      bisCertified: false,
      bisCertNo: null,
      bisCertExpiry: null,
      bpaFree: true,
      hasSmallParts: false,
    },
    seo: { title: null, description: null, index: false },
  };
}

const variantBody = {
  name: '240 pieces',
  sku: 'WB-240',
  priceMinor: 2_00_000,
  mrpMinor: 2_50_000,
  options: { size: '240' },
  active: true,
  weightGrams: 800,
};

describe('the product lifecycle through the API', () => {
  it('creates a draft, adds a variant, and publishes — enforcing the active-variant rule', async () => {
    // Create: derives the slug, returns 201 with the id + slug.
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/products',
      headers: AUTH(),
      payload: createBody('API Wooden Blocks'),
    });
    expect(created.statusCode).toBe(201);
    const { id, slug } = created.json<{ id: string; slug: string }>();
    expect(slug).toBe('api-wooden-blocks');

    // Publishing now must fail: no active variant yet.
    const earlyPublish = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${id}/status`,
      headers: AUTH(),
      payload: { status: 'active' },
    });
    expect(earlyPublish.statusCode).toBe(409);
    expect(earlyPublish.json<{ code: string }>().code).toBe('INVALID_STATE_TRANSITION');

    // Add an active variant: the product's from-price refreshes.
    const variant = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${id}/variants`,
      headers: AUTH(),
      payload: variantBody,
    });
    expect(variant.statusCode).toBe(201);

    // Now publish succeeds and revalidates.
    revalidatedTags.length = 0;
    const publish = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${id}/status`,
      headers: AUTH(),
      payload: { status: 'active' },
    });
    expect(publish.statusCode).toBe(204);
    expect(revalidatedTags.some((tags) => tags.includes('catalogue'))).toBe(true);

    // The stored document reflects the publish.
    const product = await getDocument(ctx, `products/${id}`, converters.products);
    expect(product?.status).toBe('active');
    expect(product?.priceFromMinor).toBe(2_00_000);
    expect(product?.seo.index).toBe(true);
  });

  it('registers a media slot and returns the object path under the product', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/products',
      headers: AUTH(),
      payload: createBody('Media Product'),
    });
    const { id } = created.json<{ id: string }>();

    const media = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${id}/media`,
      headers: AUTH(),
      payload: { alt: 'A tower of blocks', contentType: 'image/webp' },
    });
    expect(media.statusCode).toBe(201);
    const { path } = media.json<{ path: string }>();
    expect(path.startsWith(`products/${id}/`)).toBe(true);
    expect(path.endsWith('.webp')).toBe(true);

    const product = await getDocument(ctx, `products/${id}`, converters.products);
    expect(product?.media.some((item) => item.path === path)).toBe(true);
  });

  it('edits content and revalidates the product tags', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/products',
      headers: AUTH(),
      payload: createBody('Editable Product'),
    });
    const { id } = created.json<{ id: string }>();

    revalidatedTags.length = 0;
    const edit = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/products/${id}`,
      headers: AUTH(),
      payload: {
        ...createBody('Renamed Product'),
        seo: { title: 'Custom title', description: 'Custom description', index: true },
      },
    });
    expect(edit.statusCode).toBe(204);
    expect(revalidatedTags.some((tags) => tags.includes('catalogue'))).toBe(true);

    const product = await getDocument(ctx, `products/${id}`, converters.products);
    expect(product?.name).toBe('Renamed Product');
    expect(product?.seo.title).toBe('Custom title');
  });
});

describe('inventory adjustment through the API', () => {
  async function createProductWithVariant(
    name: string,
  ): Promise<{ id: string; variantId: string }> {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/products',
      headers: AUTH(),
      payload: createBody(name),
    });
    const { id } = created.json<{ id: string }>();
    const variant = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${id}/variants`,
      headers: AUTH(),
      payload: { ...variantBody, sku: `${variantBody.sku}-${String(Date.now())}` },
    });
    const { id: variantId } = variant.json<{ id: string }>();
    return { id, variantId };
  }

  it('adjusts stock up, updating the balance and appending a ledger entry', async () => {
    const { id, variantId } = await createProductWithVariant('Inventory Product');

    const adjust = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${id}/variants/${variantId}/inventory`,
      headers: AUTH(),
      payload: { warehouseId: 'blr', delta: 12, reason: 'adjustment', note: 'Initial stock-in.' },
    });
    expect(adjust.statusCode).toBe(200);
    const body = adjust.json<{
      onHandTotal: number;
      reserved: number;
      stock: Record<string, number>;
    }>();
    expect(body.onHandTotal).toBe(12);
    expect(body.reserved).toBe(0);
    expect(body.stock.blr).toBe(12);

    // The materialised balance reflects the adjustment.
    const inventory = await getDocument(ctx, `inventory/${variantId}`, converters.inventory);
    expect(inventory?.onHandTotal).toBe(12);
    expect((inventory?.stock as Record<string, number> | undefined)?.blr).toBe(12);

    // A second warehouse adds independently.
    const second = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${id}/variants/${variantId}/inventory`,
      headers: AUTH(),
      payload: { warehouseId: 'del', delta: 8, reason: 'reconciliation', note: null },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ onHandTotal: number }>().onHandTotal).toBe(20);
  });

  it('refuses to take a warehouse below zero with a 409', async () => {
    const { id, variantId } = await createProductWithVariant('Oversell Product');

    await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${id}/variants/${variantId}/inventory`,
      headers: AUTH(),
      payload: { warehouseId: 'blr', delta: 3, reason: 'adjustment', note: 'Stock-in.' },
    });

    const overdraw = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${id}/variants/${variantId}/inventory`,
      headers: AUTH(),
      payload: { warehouseId: 'blr', delta: -5, reason: 'adjustment', note: 'Too many out.' },
    });
    expect(overdraw.statusCode).toBe(409);
    expect(overdraw.json<{ code: string }>().code).toBe('INVALID_STATE_TRANSITION');

    // The balance is untouched — the refusal wrote nothing.
    const inventory = await getDocument(ctx, `inventory/${variantId}`, converters.inventory);
    expect(inventory?.onHandTotal).toBe(3);
  });
});
