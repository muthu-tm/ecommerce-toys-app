import { onRequest } from 'firebase-functions/v2/https';

import { buildApp } from './app';
import { buildDeps } from './bootstrap';

// Background functions: the notification dispatcher (Firestore trigger) and the backlog
// alarm (scheduled). Re-exported here because Cloud Functions discovers deployables from the
// package `main`, and this is it. They deploy alongside the HTTP `api` function in one
// codebase.
export {
  categoryProductCounter,
  mediaFinalizer,
  notificationBacklogAlarm,
  notificationDispatcher,
} from './functions';

/**
 * The Cloud Functions v2 entrypoint.
 *
 * A single HTTP function serves the whole API, so all of `/v1/*` is one deployable unit
 * behind one URL (`api.<domain>`) rather than a function per route. Fastify does the
 * routing; Functions provides the HTTP surface, scaling and the runtime credentials.
 *
 * The app is built once per instance (module scope), not per request — a cold start pays
 * for it, warm requests reuse it. The region is pinned to `asia-south1` to sit beside
 * Firestore; a cross-region hop on every write is a latency tax the customer base does not
 * need to pay.
 */

// Build the app once per instance (module scope): a cold start pays for it, warm requests
// reuse it. `buildApp` is async (it registers CORS), so the readiness promise resolves the
// built, ready instance and every request awaits it — immediately, once warm.
const ready = (async () => {
  const app = await buildApp(buildDeps());
  await app.ready();
  return app;
})();

export const api = onRequest(
  {
    region: 'asia-south1',
    // Modest concurrency and memory: the API is I/O-bound on Firestore and Auth, not
    // CPU-bound, so it serves many concurrent requests per instance cheaply.
    memory: '512MiB',
    concurrency: 80,
    // Secrets are declared here when they exist (e.g. the storefront revalidate signing
    // secret). None are needed for the identity surface, which uses runtime ADC.
  },
  (request, response) => {
    ready
      .then((app) => {
        // Hand the raw Node request/response to Fastify's server. `onRequest` gives
        // Express-shaped objects that are the same underlying Node streams Fastify expects.
        app.server.emit('request', request, response);
      })
      .catch(() => {
        // A failure to become ready is a bootstrap bug, not a request error. Fail the
        // request closed rather than leaving it hanging.
        response.writeHead(500);
        response.end();
      });
  },
);
