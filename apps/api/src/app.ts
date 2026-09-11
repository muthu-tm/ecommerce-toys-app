import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { ApiDeps } from './deps';
import { registerAuth } from './plugins/auth';
import { registerCore } from './plugins/core';
import { registerCors } from './plugins/cors';
import { createMemoryIdempotencyStore } from './plugins/idempotency';
import type { IdempotencyStore } from './plugins/idempotency';
import { createRateLimiter } from './plugins/rate-limit';
import type { RateLimiter } from './plugins/rate-limit';
import { registerAdminRoutes } from './routes/admin';
import { registerAdminAnalyticsRoutes } from './routes/admin-analytics';
import { registerAdminOrderRoutes } from './routes/admin-orders';
import { registerAuthRoutes } from './routes/auth';
import { registerCartRoutes } from './routes/cart';
import { registerCategoryRoutes } from './routes/categories';
import { registerCheckoutRoutes } from './routes/checkout';
import { registerMeRoutes } from './routes/me';
import { registerOrderRoutes } from './routes/orders';
import { registerProductRoutes } from './routes/products';
import { COMMIT, VERSION } from './version';

/**
 * Builds the Fastify application with the full middleware chain.
 *
 * A factory rather than a module-level singleton, so a test builds a fresh instance with
 * injected dependencies and the Cloud Functions entrypoint builds one per cold start.
 *
 * The registration order is the order `API.md` fixes, and it is load-bearing:
 *
 *   request-id + context + logging + error handler  (registerCore, outermost)
 *     → CORS
 *       → auth (verifies a token if present, upgrades the caller)
 *         → routes (each applies its own rate limit, validation, role guard, idempotency)
 *
 * Rate limiting, validation and idempotency are applied *per route* rather than globally,
 * because their parameters differ by route — the register limit is not the order limit, and
 * only two routes require an idempotency key. Applying them at the route keeps the ceiling
 * and the schema visible beside the handler that needs them, and `registerCore`'s error
 * handler still catches whatever any of them throws.
 */
export interface BuildAppOptions {
  /** Overrides the idempotency store; defaults to in-memory. Production injects Firestore. */
  readonly idempotencyStore?: IdempotencyStore;
  /** Overrides the clock the rate limiter reads, for window-expiry tests. */
  readonly now?: () => number;
}

export interface RompApp extends FastifyInstance {
  readonly deps: ApiDeps;
  readonly rateLimiter: RateLimiter;
  readonly idempotencyStore: IdempotencyStore;
}

export async function buildApp(deps: ApiDeps, options: BuildAppOptions = {}): Promise<RompApp> {
  const app = Fastify({
    logger: false,
    // Trust the proxy: on Cloud Functions behind Cloudflare the client IP is in
    // `x-forwarded-for`, and rate limiting keyed on IP must read the real one.
    trustProxy: true,
    // Cap request bodies. No endpoint accepts anything close; a larger body is a mistake or
    // an attempt to exhaust memory.
    bodyLimit: 1_048_576,
  }) as RompApp;

  const rateLimiter = createRateLimiter(options.now);
  const idempotencyStore = options.idempotencyStore ?? createMemoryIdempotencyStore();

  // Expose the shared building blocks to route modules without re-threading them.
  app.decorate('deps', deps);
  app.decorate('rateLimiter', rateLimiter);
  app.decorate('idempotencyStore', idempotencyStore);

  registerCore(app, deps);
  await registerCors(app, deps.config);
  registerAuth(app, deps);

  // Liveness. No auth, no database — whether the process is up and which build serves,
  // which is what a load balancer and an on-call engineer each need. It deliberately does
  // not touch Firestore: a health check that fails when a dependency is slow takes the
  // service out of rotation for a problem it does not have.
  app.get('/v1/health', () => ({ status: 'ok' as const, version: VERSION, commit: COMMIT }));

  // Identity routes. Each applies its own rate limit, validation and role guard, so the
  // ceilings and schemas sit beside the handlers rather than in a global config.
  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerAdminRoutes(app);
  registerProductRoutes(app);
  registerCategoryRoutes(app);
  registerCartRoutes(app);
  registerCheckoutRoutes(app);
  registerOrderRoutes(app);
  registerAdminOrderRoutes(app);
  registerAdminAnalyticsRoutes(app);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: ApiDeps;
    rateLimiter: RateLimiter;
    idempotencyStore: IdempotencyStore;
  }
}
