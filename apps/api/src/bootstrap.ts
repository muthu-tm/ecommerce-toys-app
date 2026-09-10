import { createStoreContext, systemClock } from '@romp/data';
import { createLogger } from '@romp/observability';
import storeConfig from '@romp/store-config/generated/store-config.json';

import type { ApiConfig, ApiDeps } from './deps';
import { auth, db } from './firebase';

/**
 * Assembles the production `ApiDeps` from the environment and the generated store config.
 *
 * Kept out of `app.ts` so the app factory stays pure — it takes dependencies, it does not
 * find them. This is the seam where the real Admin SDK clients, the configured logger and
 * the per-deployment CORS origins are wired; a test builds its own `ApiDeps` against the
 * emulator instead of calling this.
 */
export function buildDeps(): ApiDeps {
  const config = resolveConfig();

  const logger = createLogger({
    name: 'api',
    base: { store: config.storeId, commit: process.env.COMMIT_SHA ?? 'dev' },
  });

  return {
    logger,
    auth: auth(),
    context: createStoreContext({ storeId: config.storeId, db: db(), clock: systemClock }),
    config,
  };
}

/**
 * Resolves the API config: brand identity from the generated store config, CORS origins
 * from the environment.
 *
 * Brand and locale are build-time constants (the generated config is the same in every
 * environment for a given store), while the allowed origins are deployment configuration —
 * the storefront and admin hostnames differ per environment — so they come from env vars.
 */
function resolveConfig(): ApiConfig {
  const brand = storeConfig.brand;
  const locale = storeConfig.locale;

  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  // The cart-cookie signing secret is a per-environment deployment secret. It has a
  // development fallback so the emulator and a local run work without configuration, but a
  // production deploy must set `CART_COOKIE_SECRET` — a signed cookie under a shared, known
  // secret signs nothing.
  const cartCookieSecret = process.env.CART_COOKIE_SECRET ?? 'dev-cart-cookie-secret';

  return {
    storeId: brand.id,
    brandNames: [brand.name, brand.legalName],
    defaultPhoneRegion: locale.defaultPhoneRegion,
    corsOrigins,
    cartCookieSecret,
  };
}
