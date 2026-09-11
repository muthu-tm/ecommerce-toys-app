import type { PublicReviewView } from '@romp/contracts';
import { renderTemplate } from '@romp/store-config';

import { StarRating } from '@/components/StarRating';
import { content } from '@/lib/store';

/**
 * The published-review list on a product page.
 *
 * A server component: the reviews are read server-side and rendered as static markup. The `body` is
 * placed as a plain JSX child — React escapes it, so a review containing markup or a script is shown
 * as the characters the customer typed, never interpreted. It is **never** `dangerouslySetInnerHTML`;
 * that is the one rule this component exists to hold. An empty list shows the store's empty-state
 * copy rather than a bare heading.
 */
export function ReviewList({ reviews }: { readonly reviews: readonly PublicReviewView[] }) {
  const copy = content.product.reviews;

  if (reviews.length === 0) {
    return <p className="font-body text-text-muted">{copy.emptyLabel}</p>;
  }

  return (
    <ul className="flex flex-col gap-6">
      {reviews.map((review) => (
        <li key={review.id} className="flex flex-col gap-1 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <StarRating rating={review.rating} label={`${String(review.rating)} out of 5 stars`} />
            <h3 className="font-display text-base text-text-primary">{review.title}</h3>
          </div>
          <p className="font-body text-sm text-text-muted">
            {review.authorName}
            {review.verifiedPurchase ? ` · ${copy.verifiedLabel}` : ''}
          </p>
          {/* Raw body, escaped by React on render. Never dangerouslySetInnerHTML. */}
          <p className="font-body text-base leading-relaxed whitespace-pre-line text-text-secondary">
            {review.body}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The review section heading with the store's count copy, e.g. "Reviews · 12 reviews". */
export function reviewsHeading(count: number): string {
  const copy = content.product.reviews;
  if (count === 0) return copy.title;
  return `${copy.title} · ${renderTemplate(copy.countLabel, { count: String(count) })}`;
}
