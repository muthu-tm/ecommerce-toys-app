import type { DecodedIdToken } from 'firebase-admin/auth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import type { RompApp } from '../app';
import { buildTestDeps } from '../test-support/deps';

/**
 * Contract tests for the public identity routes.
 *
 * These cover the parts that decide an outcome *before* touching Firestore or Auth — input
 * validation, the password policy, rate limiting, and the auth guards. The full
 * register → login → same-uid path, duplicate-identifier atomicity and token revocation are
 * emulator-backed integration tests (they need real Auth and Firestore), and live in the
 * integration suite.
 */

let app: RompApp;

afterEach(async () => {
  await app.close();
});

describe('POST /v1/auth/register', () => {
  beforeEach(async () => {
    app = await buildApp(buildTestDeps());
    await app.ready();
  });

  it('400s a body missing required fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { identifier: 'aditi@example.com' }, // no password, no displayName
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  it('422s a weak password before creating anything', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { identifier: 'aditi@example.com', password: 'password', displayName: 'Aditi' },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json<{ code: string; detail?: string }>();
    expect(body.code).toBe('WEAK_PASSWORD');
  });

  it('400s an unparseable mobile number with a field path', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        identifier: '12345',
        password: 'velvet thunder maple orbit',
        displayName: 'Test',
      },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; errors?: { path: string }[] }>();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors?.[0]?.path).toBe('identifier');
  });
});

describe('POST /v1/auth/register rate limit', () => {
  it('429s after the register ceiling with a Retry-After', async () => {
    // Freeze the clock so all attempts fall in one window.
    app = await buildApp(buildTestDeps(), { now: () => 0 });
    await app.ready();

    // The register limit is 5/hour. A sixth weak-password attempt from one IP is limited —
    // the limiter runs before validation, so even failing requests count.
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { identifier: 'a@b.com', password: 'x', displayName: 'x' },
      });

    for (let i = 0; i < 5; i += 1) await attempt();
    const limited = await attempt();

    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ code: string }>().code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('POST /v1/auth/password-change', () => {
  it('401s with no token', async () => {
    app = await buildApp(buildTestDeps());
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-change',
      payload: { currentPassword: 'old-password-1', newPassword: 'velvet thunder maple orbit' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('422s a weak new password for a signed-in user', async () => {
    app = await buildApp(
      buildTestDeps({
        verifyIdToken: () => Promise.resolve({ uid: 'cust-1' } as unknown as DecodedIdToken),
      }),
    );
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/password-change',
      headers: { authorization: 'Bearer good' },
      payload: { currentPassword: 'old-password-1', newPassword: 'password' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ code: string }>().code).toBe('WEAK_PASSWORD');
  });
});
