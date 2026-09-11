import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import type { RompApp } from '../app';
import { buildTestDeps } from '../test-support/deps';

/**
 * Contract tests for the checkout-quote route — the layer that runs before Firestore.
 *
 * The success path resolves the caller's cart, refreshes prices and recomputes the totals, and is
 * covered against the emulator in `infra/tests/api-orders.test.ts`. Here the concern is what the
 * route decides before it touches the database: it requires a signed-in user (401 for a guest), and
 * it validates the delivery speed (400 for a malformed body). Both short-circuit before the
 * repository, so a stub db is enough.
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

const auth = { authorization: 'Bearer token' };

let app: RompApp;
afterEach(async () => {
  await app.close();
});

describe('POST /v1/checkout/quote — the auth guard', () => {
  it('401s a guest (no token)', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/checkout/quote',
      payload: { deliverySpeed: 'standard' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /v1/checkout/quote — validation', () => {
  it('400s an unknown delivery speed', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/checkout/quote',
      headers: auth,
      payload: { deliverySpeed: 'overnight' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a missing delivery speed', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/checkout/quote',
      headers: auth,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});
