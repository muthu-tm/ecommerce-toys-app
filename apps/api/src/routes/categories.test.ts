import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import type { RompApp } from '../app';
import { buildTestDeps } from '../test-support/deps';

/**
 * Contract tests for the backoffice category routes — the layer that runs before Firestore.
 *
 * The success paths write through transactions and are covered against the emulator in
 * `infra/tests/category-write.test.ts`. Here the concern is what the route decides before it
 * touches the database: the admin guard (401 anonymous, 403 customer) and request validation,
 * which short-circuit before a repository is called.
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

const validCreate = {
  name: 'Wooden toys',
  parentId: null,
  active: true,
  showInNav: true,
  showInFilters: true,
  sortOrder: 10,
};

describe('POST /v1/admin/categories — the admin guard', () => {
  it('401s an anonymous request', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      payload: validCreate,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });

  it('403s a signed-in customer without the operator claim', async () => {
    app = await makeApp(() => Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH,
      payload: validCreate,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
  });
});

describe('category route validation', () => {
  it('400s a create with an empty name', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH,
      payload: { ...validCreate, name: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a create with a malformed pinned slug', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH,
      payload: { ...validCreate, slug: 'Not A Slug' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a name that yields no derivable slug, pointing at the slug field', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories',
      headers: AUTH,
      payload: { ...validCreate, name: '!!!' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; errors?: { path: string }[] }>();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors?.some((issue) => issue.path === 'slug')).toBe(true);
  });

  it('400s a reorder that lists the same category twice', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/categories/reorder',
      headers: AUTH,
      payload: {
        orders: [
          { slug: 'wooden', sortOrder: 10 },
          { slug: 'wooden', sortOrder: 20 },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('401s an anonymous delete', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({ method: 'DELETE', url: '/v1/admin/categories/wooden' });
    expect(response.statusCode).toBe(401);
  });
});
