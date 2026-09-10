'use client';

import { useEffect } from 'react';

import { Button, ButtonLink } from '@romp/ui';

/**
 * The route error boundary.
 *
 * Must be a client component — React requires it, since it receives `reset`.
 *
 * Two deliberate choices:
 *
 *  - **It shows no error detail.** `error.message` from a server component can contain
 *    internal information, and in production Next already redacts it to a digest. Showing
 *    the digest to a customer is noise; the `digest` is logged instead so support can
 *    correlate it.
 *  - **It offers both retry and a way out.** A boundary with only "try again" traps
 *    someone whose error is not transient.
 */
export default function RouteError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // Replaced by the Sentry reporter when its adapter lands. Console is the only
    // transport available in the browser today, and this file is exempt from the
    // no-console rule for that reason.
    // eslint-disable-next-line no-console
    console.error('Route error', { digest: error.digest });
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-4 py-12">
      <h1 className="font-display text-3xl text-text-primary">Something went wrong</h1>
      <p className="max-w-md font-body text-text-secondary">
        This page failed to load. Trying again often works; if it does not, we would like to know.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="outline">
          Back to home
        </ButtonLink>
      </div>
      {error.digest === undefined ? null : (
        <p className="font-body text-xs text-text-muted">
          Reference: <code>{error.digest}</code>
        </p>
      )}
    </div>
  );
}
