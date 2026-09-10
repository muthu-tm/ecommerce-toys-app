import { MeUpdateRequestSchema } from '@romp/contracts';
import { getUser, updateUserProfile } from '@romp/data';
import { NotFoundError, parseOrThrow } from '@romp/observability';

import type { RompApp } from '../app';
import { requireAuthHook } from '../plugins/auth';
import { requireUser } from '../request-context';

/**
 * The signed-in customer's own profile.
 *
 * `GET /v1/me` returns a display-safe projection — presence booleans for email and phone,
 * never the raw values, which are PII the logger redacts and the client does not need to
 * echo. `PATCH /v1/me` updates the mutable profile fields; the identifier itself is
 * immutable in v1.0 (changing a login credential is a recovery flow, not a profile edit).
 */
export function registerMeRoutes(app: RompApp): void {
  const { context } = app.deps;

  app.get('/v1/me', { preHandler: requireAuthHook }, async (request, reply) => {
    const uid = requireUser(request);
    // `getUser` filters on the caller: a customer may read only their own record, and the
    // Admin SDK bypasses rules so this check is the control. It throws 404 for a foreign
    // uid, which cannot happen here (uid is the caller's own) but keeps the read honest.
    const user = await getUser(context, request.caller, uid);

    return reply.send({
      uid: user.id,
      displayName: user.displayName,
      primaryIdentifierType: user.primaryIdentifierType,
      emailPresent: user.email !== null,
      phonePresent: user.phone !== null,
      orderCount: user.orderCount,
    });
  });

  app.patch('/v1/me', { preHandler: requireAuthHook }, async (request, reply) => {
    const uid = requireUser(request);
    const body = parseOrThrow(MeUpdateRequestSchema, request.body);

    // Confirm the record exists (and is the caller's) before writing — a PATCH to a
    // non-existent profile is a 404, not a silent create.
    const user = await getUser(context, request.caller, uid);
    if (user.deletedAt !== null) {
      throw new NotFoundError({ detail: 'This account is closed.' });
    }

    if (body.displayName !== undefined) {
      await updateUserProfile(context, uid, { displayName: body.displayName });
    }

    const updated = await getUser(context, request.caller, uid);
    return reply.send({
      uid: updated.id,
      displayName: updated.displayName,
      primaryIdentifierType: updated.primaryIdentifierType,
      emailPresent: updated.email !== null,
      phonePresent: updated.phone !== null,
      orderCount: updated.orderCount,
    });
  });
}
