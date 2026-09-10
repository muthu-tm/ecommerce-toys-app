import { z } from 'zod';

import { AudienceSchema, NotificationTypeSchema } from '../events';
import { EventIdSchema, UidSchema } from '../primitives/ids';
import { InstantSchema, NullableInstantSchema } from '../primitives/instant';

/**
 * `notifications/{notificationId}`.
 *
 * A **projection** of the `events` spine, not an independent record. The document
 * ID is derived deterministically from `(eventId, audience, recipient)`, which is
 * what makes a dispatcher outage recoverable: fix the bug, replay the events, and
 * the replay overwrites rather than duplicates (ADR-0007).
 *
 * Read state is modelled twice on purpose, because the two audiences need
 * different things:
 *
 *   - `readAt` — a single instant, for a customer notification with one recipient.
 *   - `readBy` — a map of uid → instant, for a staff notification. Independent per
 *     admin, because one admin opening the bell must not clear it for everyone
 *     else. A single `readAt` here would mean the first admin to look hides the
 *     order from the rest of the team.
 *
 * This is the **only** collection with a client write path, and only these two
 * fields — see the write matrix in `SECURITY.md`.
 */
export const NotificationDocSchema = z
  .object({
    /** Idempotency key. The document ID is derived from this plus the recipient. */
    eventId: EventIdSchema,
    audience: AudienceSchema,
    /** Set when `audience: 'user'`, null for staff notifications. */
    userId: UidSchema.nullable(),
    type: NotificationTypeSchema,
    /** Rendered from `content.notifications` templates, so a rebrand restyles them. */
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(300),
    /** In-app deep link. A path, not an absolute URL — the origin differs per store. */
    link: z.string().min(1).max(500),

    /** For `audience: 'user'`. Null means unread, which is what the bell counts. */
    readAt: NullableInstantSchema,
    /** For `audience: 'admin'`. Absent uid means that admin has not read it. */
    readBy: z.record(UidSchema, InstantSchema),

    createdAt: InstantSchema,
    /** Notifications are not an archive; the feed is trimmed by a TTL policy. */
    expiresAt: InstantSchema,
  })
  .refine((notification) => (notification.audience === 'user') === (notification.userId !== null), {
    error: 'A customer notification is addressed to a uid; a staff notification is not.',
    path: ['userId'],
  })
  .refine((notification) => notification.audience === 'user' || notification.readAt === null, {
    // A staff notification with a single `readAt` would let the first admin to
    // open the bell mark it read for the whole team.
    error: 'Staff notifications track read state per admin in `readBy`, not in `readAt`.',
    path: ['readAt'],
  })
  .refine(
    (notification) =>
      notification.audience === 'admin' || Object.keys(notification.readBy).length === 0,
    {
      error: 'Customer notifications track read state in `readAt`, not in `readBy`.',
      path: ['readBy'],
    },
  )
  .refine((notification) => notification.expiresAt.getTime() > notification.createdAt.getTime(), {
    error: 'A notification cannot expire before it is created.',
    path: ['expiresAt'],
  });
export type NotificationDoc = z.infer<typeof NotificationDocSchema>;

/**
 * The field a customer may write on their own notification.
 *
 * Exported as a constant because the security rule, the API handler and the rules
 * test all name it, and three string literals that must agree is two too many.
 */
export const USER_READ_STATE_FIELD = 'readAt';

/** The field a staff member may write on a staff-audience notification. */
export const ADMIN_READ_STATE_FIELD = 'readBy';

/**
 * Derives the notification document ID from the event and its recipient.
 *
 * Deterministic and total: the same event fanned out twice produces the same IDs,
 * so a replay is an overwrite. The recipient is part of the key because one event
 * legitimately produces one notification per admin audience and one per customer.
 *
 * Kept here rather than in the dispatcher because the *reader* needs it too — an
 * API handler marking a notification read from an event reference must compute the
 * same ID.
 */
export function notificationId(
  eventId: string,
  audience: z.infer<typeof AudienceSchema>,
  recipient: string | null,
): string {
  return `${eventId}_${audience}_${recipient ?? 'all'}`;
}
