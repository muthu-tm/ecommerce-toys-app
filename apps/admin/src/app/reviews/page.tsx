import { ReviewQueue } from '@/components/ReviewQueue';
import { listModerationQueueForAdmin } from '@/server/reviews';

/**
 * The backoffice review-moderation queue.
 *
 * A server component reading as a staff caller, so it sees every pending review. Dynamic, not
 * cached — a moderator expects the queue to reflect the decision they just made, and the per-row
 * actions refresh it after publishing or rejecting.
 */
export const dynamic = 'force-dynamic';

export default async function ReviewsPage() {
  const reviews = await listModerationQueueForAdmin();
  return <ReviewQueue reviews={reviews} />;
}
