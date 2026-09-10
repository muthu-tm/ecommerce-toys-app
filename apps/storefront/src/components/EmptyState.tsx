import type { ReactNode } from 'react';

/**
 * A centred empty state: a title, a line of body copy, and an optional action.
 *
 * The copy is **passed in**, never hardcoded — it comes from `content.emptyStates` in
 * store config, so a second store phrases "no results" in its own voice. A component with
 * the words baked in would be a component the white-label contract cannot honour.
 */
export interface EmptyStateProps {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-16 text-center">
      <h2 className="font-display text-xl text-text-primary">{title}</h2>
      <p className="max-w-md font-body text-text-secondary">{body}</p>
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
