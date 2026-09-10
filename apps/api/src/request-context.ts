import type { FastifyRequest } from 'fastify';

import { ANONYMOUS, asCustomer, asOperator } from '@romp/data';
import type { Caller, Role } from '@romp/data';
import { ForbiddenError, UnauthenticatedError } from '@romp/observability';

/**
 * The per-request identity, decorated onto the Fastify request by the auth middleware.
 *
 * `caller` is the `@romp/data` discriminated union, built from a verified ID token — never
 * from anything the client sends. A request with no bearer token carries `ANONYMOUS`; the
 * role guard is what turns "authenticated" into "may do this".
 */
declare module 'fastify' {
  interface FastifyRequest {
    caller: Caller;
    /** Correlation ID, set by the request-id middleware and echoed as `x-request-id`. */
    requestId: string;
  }
}

/**
 * Maps a verified token's `role` custom claim to a `Caller`.
 *
 * The claim carries `staff` or `owner` (the `@romp/data` `Role`), set only by the seeded
 * admin script. Anything else — including its absence — is a customer. Reading the role
 * from a *verified* claim rather than a Firestore document is the whole security model: a
 * role stored where a client can write is a role a client can grant itself (`SECURITY.md`).
 */
export function callerFromClaims(uid: string, claims: Readonly<Record<string, unknown>>): Caller {
  const { role } = claims;
  if (role === 'owner' || role === 'staff') {
    return asOperator(uid, role satisfies Role);
  }
  return asCustomer(uid);
}

/** The anonymous caller, for requests with no credentials. */
export const anonymousCaller: Caller = ANONYMOUS;

/**
 * Requires a signed-in customer (or operator) and returns their uid, or throws 401.
 *
 * Handlers on `user` routes call this rather than re-checking the caller kind, so the
 * "who is signed in" question has one answer and 401 is raised in one place.
 */
export function requireUser(request: FastifyRequest): string {
  const { caller } = request;
  if (caller.kind === 'customer' || caller.kind === 'operator') return caller.uid;
  throw new UnauthenticatedError();
}

/**
 * Requires an operator (admin) and returns the caller, or throws.
 *
 * Throws 401 for an anonymous caller and 403 for a signed-in customer without the claim —
 * the distinction `IDENTITY.md` insists on: a customer with valid credentials but no claim
 * gets a clear "not permitted", not a blank screen or a redirect loop.
 */
export function requireOperator(request: FastifyRequest): Extract<Caller, { kind: 'operator' }> {
  const { caller } = request;
  if (caller.kind === 'operator') return caller;
  if (caller.kind === 'customer') {
    throw new ForbiddenError({ detail: 'This area is for store staff.' });
  }
  throw new UnauthenticatedError();
}
