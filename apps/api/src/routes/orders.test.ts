import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import type { RompApp } from '../app';
import { buildTestDeps } from '../test-support/deps';

/**
 * Contract tests for the order routes — the layer that runs before Firestore.
 *
 * The success path (reserve stock, mint the number, write the order and clear the cart in one
 * transaction) is covered against the emulator in `infra/tests/api-orders.test.ts`. Here the concern
 * is the guards that run before the repository: placement requires a signed-in user and a required
 * idempotency key, and validates the body; the read requires a signed-in user. All short-circuit
 * before touching Firestore, so a stub db is enough.
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
const idempotent = { ...auth, 'idempotency-key': 'order-key-0001' };

const validBody = {
  addressId: 'addr-1',
  deliverySpeed: 'standard' as const,
  isGift: false,
  giftMessage: null,
};

let app: RompApp;
afterEach(async () => {
  await app.close();
});

describe('POST /v1/orders — the auth guard', () => {
  it('401s a guest (no token)', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { 'idempotency-key': 'order-key-0001' },
      payload: validBody,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /v1/orders — the idempotency-key requirement', () => {
  it('400s a request with no Idempotency-Key header', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth,
      payload: validBody,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a malformed (too short) Idempotency-Key', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { ...auth, 'idempotency-key': 'short' },
      payload: validBody,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /v1/orders — validation', () => {
  it('400s a body with no address', async () => {
    app = await makeApp();
    const { addressId: _omit, ...rest } = validBody;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: idempotent,
      payload: rest,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s an unknown delivery speed', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: idempotent,
      payload: { ...validBody, deliverySpeed: 'overnight' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a gift message over the limit', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: idempotent,
      payload: { ...validBody, giftMessage: 'x'.repeat(501) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /v1/orders/:id — the auth guard', () => {
  it('401s a guest (no token)', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({ method: 'GET', url: '/v1/orders/order-1' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /v1/orders/:id/payment-proof — guards and validation', () => {
  const proofBody = { upiRef: '412398765432', screenshotPath: null };

  it('401s a guest (no token)', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/order-1/payment-proof',
      headers: { 'idempotency-key': 'proof-key-0001' },
      payload: proofBody,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });

  it('400s a request with no Idempotency-Key header', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/order-1/payment-proof',
      headers: auth,
      payload: proofBody,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a body with no reference', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/order-1/payment-proof',
      headers: { ...auth, 'idempotency-key': 'proof-key-0001' },
      payload: { screenshotPath: null },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a proof path that is not the caller’s own for this order', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/order-1/payment-proof',
      headers: { ...auth, 'idempotency-key': 'proof-key-0001' },
      // A path under a different order / uid.
      payload: { upiRef: '412398765432', screenshotPath: 'payment-proofs/other-order/other/p.jpg' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});
