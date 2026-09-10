import { NotFoundError } from '@romp/observability';

import type { RompApp } from '../app';
import { requireAdminHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireOperator } from '../request-context';

/**
 * Admin identity routes.
 *
 * `GET /v1/admin/me` confirms the claim — the admin app calls it to decide whether to
 * render the backoffice or a clear "not permitted", never a blank screen. The role guard
 * has already verified the operator claim server-side; this just echoes who they are.
 *
 * `POST /v1/admin/users/:uid/password-reset` is the WhatsApp-assisted reset for a
 * mobile-only customer who cannot use Firebase's email reset. An admin verifies identity
 * against order history (the runbook), then mints a single-use, short-TTL link the admin
 * sends over WhatsApp. Every call is attributable to the acting admin.
 */
export function registerAdminRoutes(app: RompApp): void {
  const { auth } = app.deps;

  app.get('/v1/admin/me', { preHandler: requireAdminHook }, (request, reply) => {
    const operator = requireOperator(request);
    return reply.send({ uid: operator.uid, role: operator.role });
  });

  app.post(
    '/v1/admin/users/:uid/password-reset',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      const operator = requireOperator(request);
      app.rateLimiter.consume(rateLimitKey(request, 'passwordReset'), RATE_LIMITS.passwordReset);

      const { uid } = request.params as { uid: string };

      // Confirm the target exists before minting a link, so a typo'd uid is a clean 404
      // rather than a link to nothing.
      const target = await auth.getUser(uid).catch(() => null);
      if (target === null) {
        throw new NotFoundError({ detail: 'No such customer.' });
      }

      // Firebase mints the single-use, short-TTL reset link against the account's login
      // email — the real email, or the phone alias. The link is returned to the admin, who
      // relays it over WhatsApp; the platform sends nothing itself (ADR-0007). The action is
      // logged with the acting admin's uid for the audit trail.
      const link = await auth.generatePasswordResetLink(target.email ?? '');

      app.deps.logger.info(
        { event: 'admin.password_reset_minted', actorUid: operator.uid, targetUid: uid },
        'admin.password_reset',
      );

      // The link is the whole payload; it is a capability, so it is returned to the
      // authenticated admin only and never logged.
      return reply.send({ resetLink: link });
    },
  );
}
