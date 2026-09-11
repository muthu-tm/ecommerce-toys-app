import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import type { RompApp } from '../app';
import { buildTestDeps } from '../test-support/deps';

/**
 * Contract tests for the admin order-and-money routes — the layer before Firestore.
 *
 * The success paths commit stock and move money through transactions covered against the emulator in
 * `infra/tests`. Here the concern is what the routes decide first: the admin claim guards (a customer
 * is 403, a guest 401), request validation, and — crucially — that a refund is refused for a staff
 * caller who lacks the owner claim, which the repository enforces before any read so it is visible
 * in-process (a 404, deliberately not a 403, so the action is not disclosed).
 */

const ownerToken = (): Promise<DecodedIdToken> =>
  Promise.resolve({ uid: 'owner-1', role: 'owner' } as unknown as DecodedIdToken);

async function makeApp(
  verifyIdToken: (token: string) => Promise<DecodedIdToken> = ownerToken,
): Promise<RompApp> {
  const app = await buildApp(buildTestDeps({ verifyIdToken }));
  await app.ready();
  return app;
}

const AUTH = { authorization: 'Bearer token' };

let app: RompApp;
afterEach(async () => {
  await app.close();
});

describe('the admin claim guard', () => {
  it('401s a guest on the queue', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({ method: 'GET', url: '/v1/admin/orders' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });

  it('403s a signed-in customer without the operator claim', async () => {
    app = await makeApp(() => Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orders/order-1/verify-payment',
      headers: AUTH,
      payload: { paidAmountMinor: 100 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
  });
});

describe('POST /v1/admin/orders/:id/verify-payment — validation', () => {
  it('400s a body with no amount', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orders/order-1/verify-payment',
      headers: AUTH,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a fractional amount', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orders/order-1/verify-payment',
      headers: AUTH,
      payload: { paidAmountMinor: 100.5 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /v1/admin/orders/:id/reject-payment — validation', () => {
  it('400s a missing reason', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orders/order-1/reject-payment',
      headers: AUTH,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /v1/admin/refunds — validation and the owner guard', () => {
  const validRefund = {
    orderId: 'order-1',
    mode: 'full' as const,
    amountMinor: 2_90_976,
    reason: 'customer_cancelled' as const,
    note: null,
    outwardUpiRef: null,
    restock: true,
  };

  it('400s a zero-amount refund', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/refunds',
      headers: AUTH,
      payload: { ...validRefund, amountMinor: 0 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a reason that needs a note without one', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/refunds',
      headers: AUTH,
      payload: { ...validRefund, reason: 'other', note: null },
    });
    expect(response.statusCode).toBe(400);
  });

  it('404s a staff caller — refunds require the owner claim', async () => {
    // A staff operator passes the admin claim guard but `requireOwnerRole` in the repository
    // refuses before any read, surfacing as a 404 that does not disclose the action exists.
    app = await makeApp(() =>
      Promise.resolve({ uid: 'staff-1', role: 'staff' } as unknown as DecodedIdToken),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/refunds',
      headers: AUTH,
      payload: validRefund,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('NOT_FOUND');
  });
});

describe('GET /v1/admin/orders — the list', () => {
  it('403s a signed-in customer', async () => {
    app = await makeApp(() => Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken));
    const response = await app.inject({ method: 'GET', url: '/v1/admin/orders', headers: AUTH });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
  });

  it('400s an over-limit page size', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/orders?limit=500',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s an unknown status filter', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/orders?status=nope',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /v1/admin/orders/:id/fulfilment — validation', () => {
  it('400s shipping with no carrier or tracking', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orders/order-1/fulfilment',
      headers: AUTH,
      payload: { status: 'shipped' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s an unknown fulfilment status', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orders/order-1/fulfilment',
      headers: AUTH,
      payload: { status: 'shipping' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /v1/admin/orders/:id/cancel — validation', () => {
  it('400s a missing reason', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/orders/order-1/cancel',
      headers: AUTH,
      payload: { restock: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /v1/admin/analytics/daily — validation and guard', () => {
  it('403s a signed-in customer', async () => {
    app = await makeApp(() => Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken));
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/daily?from=2026-03-01&to=2026-03-31',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(403);
  });

  it('400s a range whose start is after its end', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/daily?from=2026-03-31&to=2026-03-01',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });
});
