import Link from 'next/link';

import { ButtonLink } from '@romp/ui';

/**
 * Cursor pagination: a "next" link, and a "start over" link once past the first page.
 *
 * Not numbered pages, deliberately — cursor pagination has no notion of page N, because
 * the cursor encodes *where the last page ended*, not an offset (ADR-0002). Numbered
 * pages would require counting the whole result set and computing offsets, which is the
 * expensive, drift-prone thing cursors exist to avoid.
 *
 * A link, not a button: the next page has a URL, so it is navigation. That means it works
 * with JavaScript disabled, opens in a new tab on middle-click, and is crawlable — a
 * "next" button that only responded to a click would hide the rest of the catalogue from
 * search engines.
 *
 * Rendered on the server, so there is nothing to hydrate.
 */
export interface PaginationProps {
  /** The path without query string, e.g. `/c/wooden`. */
  readonly basePath: string;
  /** The current query string params, minus the cursor, preserved across pages. */
  readonly params: URLSearchParams;
  /** The cursor for the next page, or null on the last page. */
  readonly nextCursor: string | null;
  /** Whether a non-first page is being shown, so "start over" is worth offering. */
  readonly hasCursor: boolean;
}

function withParams(basePath: string, params: URLSearchParams): string {
  const queryString = params.toString();
  return queryString === '' ? basePath : `${basePath}?${queryString}`;
}

export function Pagination({ basePath, params, nextCursor, hasCursor }: PaginationProps) {
  // Nothing to show on a single, first page.
  if (nextCursor === null && !hasCursor) return null;

  const firstPageParams = new URLSearchParams(params);
  firstPageParams.delete('cursor');

  const nextParams = new URLSearchParams(params);
  if (nextCursor !== null) nextParams.set('cursor', nextCursor);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 pt-4">
      {hasCursor ? (
        <Link
          href={withParams(basePath, firstPageParams)}
          className="font-body text-sm text-text-secondary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Back to start
        </Link>
      ) : (
        <span />
      )}

      {nextCursor !== null && (
        <ButtonLink href={withParams(basePath, nextParams)} variant="outline">
          Next page
        </ButtonLink>
      )}
    </nav>
  );
}
