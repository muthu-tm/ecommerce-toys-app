'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@romp/ui';

import { ApiError, adminApi } from '@/lib/api';

/**
 * The moderation controls for one pending review: publish, or reject with a reason.
 *
 * A client component, because these are actions, not navigations. Publishing carries no body and
 * moves the review to `published` (where the storefront can read it and the rating trigger counts
 * it); rejecting collects a reason — required, recorded for the audit, never shown to the author —
 * and hides the review. After either, the list refreshes so the acted review leaves the queue.
 *
 * Until operator sign-in lands the API client returns "Sign in as a staff member", so the controls
 * render and explain rather than silently doing nothing — the same inert posture as the order
 * controls.
 */
export function ReviewModerationActions({ reviewId }: { readonly reviewId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const run = (action: () => Promise<unknown>): void => {
    setPending(true);
    setError(null);
    void action()
      .then(() => {
        router.refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'The action could not be completed.');
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            run(() => adminApi.publishReview(reviewId));
          }}
        >
          Publish
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setRejecting((open) => !open);
          }}
        >
          Reject
        </Button>
      </div>

      {rejecting ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-body text-sm text-text-muted">
              Reason (recorded for the audit; not shown to the customer)
            </span>
            <input
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              className="rounded-md border border-border bg-surface px-3 py-2 font-body text-text-primary"
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || reason.trim() === ''}
            onClick={() => {
              run(() => adminApi.rejectReview(reviewId, { reason }));
            }}
          >
            Confirm rejection
          </Button>
        </div>
      ) : null}

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
