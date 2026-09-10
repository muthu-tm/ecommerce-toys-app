import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import type { RompApp } from '../app';
import { buildTestDeps } from '../test-support/deps';

/**
 * Contract tests for the cart routes — the layer that runs before Firestore.
 *
 * The success paths write through the cart transaction and are covered against the emulator in
 * `infra/tests/api-cart.test.ts`. Here the concern is what the routes decide before they touch the
 * database: request validation (a malformed add is a 400), and that merge requires a signed-in user
 * (401 for a guest). These short-circuit before the repository, so a stub db is enough.
 */

const customerToken = (): Promise<DecodedIdToken> =>
  Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken);

async function makeApp(
  verifyIdToken: (token: string) => Promise<DecodedIdToken> = customerToken,
): Promise<RompApp> {
  const app = await buildApp(buildTestDeps({ verifyIdToken }));
  await app.ready();
  return app;
}

let app: RompApp;
afterEach(async () => {
  await app.close();
});

describe('POST /v1/cart/items — validation', () => {
  it('400s a body with a non-positive quantity', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/cart/items',
      payload: { productId: 'p1', variantId: 'v1', qty: 0, mode: 'add' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s an unknown mode', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/cart/items',
      payload: { productId: 'p1', variantId: 'v1', qty: 1, mode: 'delete' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});

describe('PATCH /v1/cart — validation', () => {
  it('400s a missing giftWrap flag', async () => {
    app = await makeApp();
    const response = await app.inject({ method: 'PATCH', url: '/v1/cart', payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /v1/cart/merge — the auth guard', () => {
  it('401s a guest (no token)', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({ method: 'POST', url: '/v1/cart/merge' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });
});
