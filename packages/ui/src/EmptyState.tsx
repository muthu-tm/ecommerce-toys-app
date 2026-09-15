import type { ReactNode } from 'react';

import { cn } from './cn';

export interface EmptyStateProps {
  readonly title: string;
  readonly body: string;
  /** A call to action — a button or link. */
  readonly action?: ReactNode;
  /** An optional decorative glyph or illustration above the title. */
  readonly icon?: ReactNode;
  readonly className?: string;
}

/**
 * A centred empty state: an optional glyph, a title, a line of body copy, and an optional
 * action.
 *
 * The copy is always **passed in**, never hardcoded — it comes from `content.emptyStates`
 * in store config, so a second store phrases "no results" in its own voice. A component
 * with the words baked in could not honour the white-label contract. The icon is
 * decorative (`aria-hidden` is the caller's responsibility on the node they pass) and adds
 * warmth to what is otherwise a bare box.
 */
export function EmptyState({ title, body, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-16 text-center',
        className,
      )}
    >
      {icon === undefined ? null : <div className="text-text-muted">{icon}</div>}
      <h2 className="font-display text-xl text-text-primary">{title}</h2>
      <p className="max-w-md font-body text-text-secondary">{body}</p>
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
