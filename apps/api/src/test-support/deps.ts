import type { Auth } from 'firebase-admin/auth';

import { createStoreContext, systemClock } from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import type { ApiConfig, ApiDeps } from '../deps';

/**
 * Builds `ApiDeps` for a route test.
 *
 * A silent logger, a fake `Auth` whose `verifyIdToken` is supplied per test, and a
 * `StoreContext` over a stub or emulator `db`. Middleware and route-contract tests use a
 * stub `db` (they never reach Firestore); the emulator integration suite passes a real one.
 */
export interface TestDepsOptions {
  /** The token verifier. Defaults to one that rejects every token (all requests anonymous). */
  readonly verifyIdToken?: Auth['verifyIdToken'];
  /** The Firestore instance for the context. A stub is fine for tests that never read it. */
  readonly db?: unknown;
  readonly config?: Partial<ApiConfig>;
}

const DEFAULT_CONFIG: ApiConfig = {
  storeId: 'test-store',
  brandNames: ['Test Store'],
  defaultPhoneRegion: 'IN',
  corsOrigins: ['https://shop.test'],
  cartCookieSecret: 'test-cart-cookie-secret',
};

export function buildTestDeps(options: TestDepsOptions = {}): ApiDeps {
  const verifyIdToken =
    options.verifyIdToken ?? (() => Promise.reject(new Error('no token verifier configured')));

  // A minimal fake Auth: only the methods a test exercises are defined, cast through the
  // client type. A test that calls an undefined method fails loudly, which is the point.
  const auth = { verifyIdToken } as unknown as Auth;

  const config: ApiConfig = { ...DEFAULT_CONFIG, ...options.config };

  return {
    logger: createSilentLogger(),
    auth,
    context: createStoreContext({
      storeId: config.storeId,
      db: (options.db ?? {}) as never,
      clock: systemClock,
    }),
    config,
  };
}
