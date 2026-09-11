import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import type { RompApp } from '../app';
import { buildTestDeps } from '../test-support/deps';

/**
 * Contract tests for the wishlist routes — the layer before Firestore.
 *
 * The toggle and the product-existence guard are proven against the emulator; here the concern is
 * authentication. The feature gate (a store with wishlist off refuses) is exercised by the
 * `_template` build, whose generated config has the flag off — the test store (ROMP) has it on.
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

describe('the wishlist routes', () => {
  it('401s a guest adding to the wishlist', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({ method: 'PUT', url: '/v1/wishlist/wooden-blocks' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });

  it('401s a guest removing from the wishlist', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({ method: 'DELETE', url: '/v1/wishlist/wooden-blocks' });
    expect(response.statusCode).toBe(401);
  });
});
