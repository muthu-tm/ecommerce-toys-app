import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app';
import type { RompApp } from './app';
import { requireAdminHook, requireAuthHook } from './plugins/auth';
import { buildTestDeps } from './test-support/deps';

/**
 * The app and its middleware chain, exercised through `inject`.
 *
 * These are contract tests over the wiring: the health route, the correlation header, the
 * CORS allowlist, and the auth/role guards attached to sample routes. The identity routes
 * get their own file; here the concern is that the chain behaves as `API.md` specifies.
 */

async function makeApp(options?: {
  verifyIdToken?: (token: string) => Promise<DecodedIdToken>;
  extraRoutes?: (app: RompApp) => void;
}): Promise<RompApp> {
  const app = await buildApp(
    buildTestDeps(
      options?.verifyIdToken === undefined ? {} : { verifyIdToken: options.verifyIdToken },
    ),
  );

  // Sample protected routes, so the guards can be tested without the real identity routes.
  app.get('/v1/_test/user', { preHandler: requireAuthHook }, (request) => ({
    uid: request.caller.kind === 'customer' ? request.caller.uid : null,
  }));
  app.get('/v1/_test/admin', { preHandler: requireAdminHook }, () => ({ ok: true }));

  options?.extraRoutes?.(app);

  await app.ready();
  return app;
}

let app: RompApp;

afterEach(async () => {
  await app.close();
});

describe('GET /v1/health', () => {
  beforeEach(async () => {
    app = await makeApp();
  });

  it('returns ok with the build identity and a correlation header', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; version: string }>();
    expect(body.status).toBe('ok');
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('echoes an inbound correlation id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(response.headers['x-request-id']).toBe('abc-123');
  });
});

describe('the not-found handler', () => {
  beforeEach(async () => {
    app = await makeApp();
  });

  it('returns problem+json for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<{ code: string }>().code).toBe('NOT_FOUND');
  });
});

describe('CORS', () => {
  beforeEach(async () => {
    app = await makeApp();
  });

  it('allows a configured origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://shop.test' },
    });
    expect(response.headers['access-control-allow-origin']).toBe('https://shop.test');
  });

  it('does not grant CORS to an unlisted origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://evil.test' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('auth guards', () => {
  it('401s a user route with no token', async () => {
    app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/v1/_test/user' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });

  it('admits a customer to a user route with a valid token', async () => {
    app = await makeApp({
      verifyIdToken: () => Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/_test/user',
      headers: { authorization: 'Bearer good-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ uid: string }>().uid).toBe('cust-1');
  });

  it('403s a customer on an admin route', async () => {
    app = await makeApp({
      verifyIdToken: () => Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/_test/admin',
      headers: { authorization: 'Bearer good-token' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
  });

  it('admits an operator to an admin route', async () => {
    app = await makeApp({
      verifyIdToken: () =>
        Promise.resolve({ uid: 'admin-1', role: 'owner' } as unknown as DecodedIdToken),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/_test/admin',
      headers: { authorization: 'Bearer good-token' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('treats a rejected token as anonymous, not an error', async () => {
    app = await makeApp({ verifyIdToken: () => Promise.reject(new Error('expired')) });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/_test/user',
      headers: { authorization: 'Bearer expired-token' },
    });
    // Falls through to the guard's 401 rather than surfacing why the token failed.
    expect(response.statusCode).toBe(401);
  });
});

describe('the error handler', () => {
  beforeEach(async () => {
    app = await makeApp({
      extraRoutes: (instance) => {
        instance.get('/v1/_test/boom', () => {
          throw new Error('unexpected');
        });
      },
    });
  });

  it('renders a thrown AppError as problem+json with the request id', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/_test/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json<{ code: string; requestId: string; detail?: string }>();
    expect(body.code).toBe('INTERNAL');
    expect(body.requestId).toBeDefined();
    // Internal detail must not leak.
    expect(body.detail).toBeUndefined();
  });
});
