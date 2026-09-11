import type { ReviewDoc } from '@romp/contracts';
import type { WithId } from '@romp/data';
import { Badge, Card } from '@romp/ui';

import { ReviewModerationActions } from '@/components/ReviewModerationActions';

/**
 * The backoffice review-moderation queue.
 *
 * A server component: the pending reviews are read as a staff caller, oldest first. Each row shows
 * the whole review — the author's name and uid, the rating, the title and body, and whether the
 * purchase was verified — so a moderator decides with full context, then acts through the per-row
 * client controls. The body is a plain JSX child, escaped by React; it is never
 * `dangerouslySetInnerHTML`, the same rule the storefront holds. An empty queue is a good state, so
 * it says so rather than showing a bare heading.
 */
export function ReviewQueue({ reviews }: { readonly reviews: readonly WithId<ReviewDoc>[] }) {
  return (
    <section aria-labelledby="reviews-heading" className="flex flex-col gap-6">
      <h1 id="reviews-heading" className="font-display text-2xl text-text-primary">
        Reviews awaiting moderation
      </h1>

      {reviews.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-body text-text-muted">Nothing to moderate. The queue is clear.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {reviews.map((review) => (
            <li key={review.id}>
              <Card className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="font-body text-accent">
                      {'★'.repeat(review.rating)}
                      {'☆'.repeat(5 - review.rating)}
                    </span>
                    <span className="sr-only">{review.rating} out of 5 stars</span>
                    <h2 className="font-display text-base text-text-primary">{review.title}</h2>
                  </div>
                  {review.verifiedPurchase ? (
                    <Badge tone="success">Verified purchase</Badge>
                  ) : (
                    <Badge tone="neutral">Unverified</Badge>
                  )}
                </div>

                <p className="font-body text-sm text-text-muted">
                  {review.authorName} · {review.userId}
                </p>

                {/* Raw body, escaped by React on render. Never dangerouslySetInnerHTML. */}
                <p className="font-body text-base whitespace-pre-line text-text-secondary">
                  {review.body}
                </p>

                <ReviewModerationActions reviewId={review.id} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
