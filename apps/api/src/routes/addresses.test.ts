import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import type { RompApp } from '../app';
import { buildTestDeps } from '../test-support/deps';

/**
 * Contract tests for the address routes — the layer before Firestore.
 *
 * The single-default transaction is proven against the emulator; here the concern is what the routes
 * decide first: authentication (a guest is 401), and request validation (a create needs the postal
 * shape and a default intent; an update must not be empty).
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

const AUTH = { authorization: 'Bearer token' };
const validAddress = {
  label: 'Home',
  recipientName: 'Asha Menon',
  line1: '12 Palm Grove',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  phone: '+919845021174',
  isDefault: true,
};

let app: RompApp;
afterEach(async () => {
  await app.close();
});

describe('POST /v1/addresses', () => {
  it('401s a guest', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/addresses',
      payload: validAddress,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });

  it('400s a body with a malformed PIN code', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/addresses',
      headers: AUTH,
      payload: { ...validAddress, pincode: '12' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('400s a body missing the default intent', async () => {
    app = await makeApp();
    const { isDefault: _omit, ...withoutDefault } = validAddress;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/addresses',
      headers: AUTH,
      payload: withoutDefault,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('PATCH /v1/addresses/:id', () => {
  it('400s an empty patch', async () => {
    app = await makeApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/addresses/addr-1',
      headers: AUTH,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('401s a guest', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/addresses/addr-1',
      payload: { label: 'X' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('DELETE /v1/addresses/:id', () => {
  it('401s a guest', async () => {
    app = await makeApp(() => Promise.reject(new Error('no token')));
    const response = await app.inject({ method: 'DELETE', url: '/v1/addresses/addr-1' });
    expect(response.statusCode).toBe(401);
  });
});
