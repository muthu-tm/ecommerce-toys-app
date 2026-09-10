import type { FastifyInstance, FastifyRequest } from 'fastify';

import { UnauthenticatedError } from '@romp/observability';

import type { ApiDeps } from '../deps';
import { callerFromClaims, requireOperator, requireUser } from '../request-context';

/**
 * Firebase ID-token verification and the role guard.
 *
 * Registered as a global `preHandler` that runs *after* validation and rate limiting: it
 * reads the `Authorization: Bearer <token>` header, verifies it with the Admin SDK, and
 * upgrades `request.caller` from anonymous to the customer or operator the token proves.
 *
 * Verification is best-effort at this layer — a missing or bad token leaves the caller
 * anonymous rather than throwing — because some routes are public and some accept either an
 * anonymous cart cookie or a token. The routes that *require* a signed-in user or an admin
 * enforce that themselves with `requireUser` / `requireOperator`, so authorisation is a
 * decision made at the route, visibly, rather than inferred from middleware order.
 */
export function registerAuth(app: FastifyInstance, deps: ApiDeps): void {
  const { auth, logger } = deps;

  app.addHook('preHandler', async (request) => {
    const token = bearerToken(request);
    if (token === null) return;

    try {
      // `checkRevoked: true` so a token whose refresh tokens were revoked (password change,
      // sign-out-everywhere) is rejected even before it expires — the session-revocation
      // control `IDENTITY.md` requires on sensitive routes.
      const decoded = await auth.verifyIdToken(token, true);
      request.caller = callerFromClaims(decoded.uid, decoded);
    } catch {
      // A malformed or expired token is treated as no token: the caller stays anonymous and
      // a protected route will 401 through `requireUser`. We do not surface *why* the token
      // failed — that is information about the token's holder. The failure is logged by
      // type only.
      logger.info({ event: 'token.rejected' }, 'auth.token_rejected');
    }
  });
}

/** Extracts the bearer token, or null if absent or malformed. */
function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header === undefined) return null;
  const match = /^Bearer (.+)$/u.exec(header);
  return match?.[1]?.trim() ?? null;
}

/**
 * A `preHandler` for routes that require a signed-in user.
 *
 * Attached per route (`preHandler: requireAuthHook`) rather than globally, so the routes
 * that need it declare it and the public ones do not accidentally inherit it. `async` so a
 * throw becomes a rejected promise Fastify routes to the error handler — a synchronous
 * single-argument hook would leave Fastify waiting on a `done` that never comes.
 */
export function requireAuthHook(request: FastifyRequest): Promise<void> {
  requireUser(request);
  return Promise.resolve();
}

/** A `preHandler` for routes that require the admin (operator) claim. */
export function requireAdminHook(request: FastifyRequest): Promise<void> {
  requireOperator(request);
  return Promise.resolve();
}

/** Thrown-if-absent bearer requirement, for routes with no public mode at all. */
export function assertBearerPresent(request: FastifyRequest): void {
  if (bearerToken(request) === null) throw new UnauthenticatedError();
}
