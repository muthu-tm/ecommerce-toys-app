import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

import type { ApiConfig } from '../deps';

/**
 * CORS with an explicit origin allowlist.
 *
 * `API.md` is emphatic: no wildcard, including in development. A credentialed API answering
 * `Access-Control-Allow-Origin: *` lets any site make authenticated requests on a signed-in
 * user's behalf. The allowlist is the storefront and admin origins for this deployment,
 * from config, so each environment permits its own hosts and nothing else.
 *
 * An origin not on the list is simply not granted CORS headers — the browser then blocks
 * the response. We do not throw, because a same-origin or server-to-server request has no
 * `Origin` header and must still work.
 */
export async function registerCors(app: FastifyInstance, config: ApiConfig): Promise<void> {
  const allowed = new Set(config.corsOrigins);

  await app.register(cors, {
    origin: (origin, callback) => {
      // No Origin header: same-origin, curl, or server-to-server. Allowed.
      if (origin === undefined) {
        callback(null, true);
        return;
      }
      callback(null, allowed.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'Retry-After'],
  });
}
