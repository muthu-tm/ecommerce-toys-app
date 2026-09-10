import type { Metadata } from 'next';

import { ButtonLink } from '@romp/ui';

import { content } from '@/lib/store';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * 404.
 *
 * Reuses the configured no-results copy rather than inventing its own, so a store writes
 * that message once. Offers a route onward — a dead end with no link is how a 404 becomes
 * an exit.
 */
export default function NotFound() {
  const { noResults } = content.emptyStates;

  return (
    <div className="flex flex-col items-start gap-4 py-12">
      <h1 className="font-display text-3xl text-text-primary">{noResults.title}</h1>
      <p className="max-w-md font-body text-text-secondary">{noResults.body}</p>
      <ButtonLink href="/">Back to home</ButtonLink>
    </div>
  );
}
