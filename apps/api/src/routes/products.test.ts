import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import type { RompApp } from '../app';
import { buildTestDeps } from '../test-support/deps';

/**
 * Contract tests for the backoffice product routes — the layer that runs before Firestore.
 *
 * The success paths write through transactions and are covered against the emulator in
 * `infra/tests/catalogue-write.test.ts`. Here the concern is everything the route decides
 * before it touches the database: the admin guard (401 for anonymous, 403 for a customer),
 * request validation (422 on a malformed body), and the slug-derivation failure that must
 * surface as a field error rather than a 500. These all short-circuit before a repository is
 * called, so a stub `db` is enough.
 */

const operatorToken = (): Promise<DecodedIdToken> =>
  Promise.resolve({ uid: 'admin-1', role: 'owner' } as unknown as DecodedIdToken);

async function makeApp(
  verifyIdToken: (token: string) => Promise<DecodedIdToken> = operatorToken,
): Promise<RompApp> {
  const app = await buildApp(buildTestDeps({ verifyIdToken }));
  await app.ready();
  return app;
}

let app: RompApp;
afterEach(async () => {
  await app.close();
});

const AUTH = { authorization: 'Bearer token' };

function validCreateBody() {
  return {
    name: 'Wooden Blocks',
    description: 'A set of sanded beechwood blocks.',
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

describe('POST /v1/admin/products — the admin guard', () => {
  it('401s an anonymous request', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/products',
      payload: validCreateBody(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });

  it('403s a signed-in customer without the operator claim', async () => {
    app = await makeApp(() => Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/products',
      headers: AUTH,
      payload: validCreateBody(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
  });
});

describe('POST /v1/admin/products — validation', () => {
  it('422s a body missing required fields', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/products',
      headers: AUTH,
      payload: { name: 'X' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('422s a name that yields no derivable slug, pointing at the slug field', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/products',
      headers: AUTH,
      payload: { ...validCreateBody(), name: '!!!' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; errors?: { path: string }[] }>();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors?.some((issue) => issue.path === 'slug')).toBe(true);
  });
});

describe('POST /v1/admin/products/:id/status — validation', () => {
  it('422s an unknown status value', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/products/p1/status',
      headers: AUTH,
      payload: { status: 'live' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /v1/admin/products/:id/media — validation', () => {
  it('422s a disallowed content type', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/products/p1/media',
      headers: AUTH,
      payload: { alt: 'A toy', contentType: 'image/svg+xml' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /v1/admin/products/:id/variants/:variantId/inventory — the admin guard', () => {
  const url = '/v1/admin/products/p1/variants/v1/inventory';
  const validAdjust = {
    warehouseId: 'blr',
    delta: 3,
    reason: 'adjustment',
    note: 'Recount found three more.',
  };

  it('401s an anonymous request', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({ method: 'POST', url, payload: validAdjust });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });

  it('403s a signed-in customer without the operator claim', async () => {
    app = await makeApp(() => Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken));
    const response = await app.inject({ method: 'POST', url, headers: AUTH, payload: validAdjust });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
  });
});

describe('POST /v1/admin/products/:id/variants/:variantId/inventory — validation', () => {
  const url = '/v1/admin/products/p1/variants/v1/inventory';

  it('400s a zero delta', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url,
      headers: AUTH,
      payload: { warehouseId: 'blr', delta: 0, reason: 'adjustment', note: 'x' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a manual adjustment with no note', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url,
      headers: AUTH,
      payload: { warehouseId: 'blr', delta: 3, reason: 'adjustment', note: null },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a system reason an operator may not select', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url,
      headers: AUTH,
      payload: { warehouseId: 'blr', delta: 3, reason: 'order_committed', note: 'x' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});
