'use client';

import { useEffect, useState } from 'react';

import type { OwnReviewView } from '@romp/contracts';
import { Badge, Card } from '@romp/ui';

import { StarRating } from '@/components/StarRating';
import { accountApi } from '@/lib/account-api';
import { useAuth } from '@/lib/auth-context';

import { SignedOut } from './SignedOut';

/**
 * The customer's own reviews — every one they have written, in any status.
 *
 * This is the surface the moderation design turns on: an author sees their `pending` review here
 * (so it reads as received, not lost) and a `rejected` one as not shown — but never the rejection
 * reason, which is a moderation note the server does not return. Reads through `GET /v1/account/
 * reviews`, filtered to the caller server-side. The body is a plain JSX child, escaped by React.
 */
export function ReviewsView() {
  const { uid, ready } = useAuth();
  const [reviews, setReviews] = useState<readonly OwnReviewView[] | null>(null);

  useEffect(() => {
    if (uid === null) {
      setReviews(null);
      return;
    }
    void accountApi
      .listReviews()
      .then((response) => {
        setReviews(response.reviews);
      })
      .catch(() => {
        setReviews([]);
      });
  }, [uid]);

  if (!ready) return <p className="font-body text-text-muted">Loading…</p>;
  if (uid === null)
    return <SignedOut next="/account/reviews" message="Sign in to see your reviews." />;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="reviews-heading">
      <h1 id="reviews-heading" className="font-display text-2xl text-text-primary">
        Your reviews
      </h1>

      {reviews === null ? (
        <p className="font-body text-text-muted">Loading…</p>
      ) : reviews.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-display text-base text-text-primary">No reviews yet.</p>
          <p className="mt-1 font-body text-sm text-text-muted">
            Reviews you write will appear here, including any still awaiting approval.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => (
            <li key={review.id}>
              <Card className="flex flex-col gap-1 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StarRating
                      rating={review.rating}
                      label={`${String(review.rating)} out of 5 stars`}
                    />
                    <span className="font-display text-base text-text-primary">{review.title}</span>
                  </div>
                  <Badge tone={statusTone(review.status)}>{statusLabel(review.status)}</Badge>
                </div>
                <p className="font-body text-sm whitespace-pre-line text-text-secondary">
                  {review.body}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Maps a review status to a customer-facing label — never the rejection reason. */
function statusLabel(status: OwnReviewView['status']): string {
  if (status === 'published') return 'Published';
  if (status === 'pending') return 'Awaiting approval';
  return 'Not published';
}

/** The badge tone for each status. */
function statusTone(status: OwnReviewView['status']): 'success' | 'neutral' | 'warning' {
  if (status === 'published') return 'success';
  if (status === 'pending') return 'warning';
  return 'neutral';
}
