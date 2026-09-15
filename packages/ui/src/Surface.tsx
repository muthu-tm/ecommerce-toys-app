import type { ElementType, HTMLAttributes, ReactNode } from 'react';

import { cn } from './cn';
import { FOCUS_RING } from './focus';
import { TRANSITION } from './motion';

/** A raised panel. The default container for product cards, forms and summaries. */
export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  readonly className?: string;
  readonly children: ReactNode;
  /** Adds hover lift. Only for cards that are themselves a link or button. */
  readonly interactive?: boolean;
  /**
   * The element to render. Defaults to `div`; pass `section`, `article` or `li` when the
   * card is a semantic region so the document outline stays correct — a card carrying a
   * heading and `aria-labelledby` should be a `section`, not a `div`.
   */
  readonly as?: ElementType;
}

export function Card({ className, children, interactive = false, as: Element = 'div', ...rest }: CardProps) {
  return (
    <Element
      className={cn(
        'rounded-lg border border-border bg-surface shadow-card',
        interactive &&
          'hover:-translate-y-0.5 hover:border-border-strong motion-reduce:hover:translate-y-0',
        TRANSITION,
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
}

export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Readonly<Record<BadgeTone, string>> = Object.freeze({
  neutral: 'bg-surface-alt text-text-secondary',
  primary: 'bg-primary text-primary-on',
  accent: 'bg-accent text-accent-on',
  // Status tones use the status colour as *text* on a neutral surface rather than as a
  // fill. The contrast gate holds status colours to AA as text, and a coloured fill would
  // need its own on-colour token per tone to make the same guarantee.
  success: 'bg-surface-alt text-success',
  warning: 'bg-surface-alt text-warning',
  danger: 'bg-surface-alt text-danger',
});

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A small status or category label.
 *
 * Purely visual. A badge must never be the only way a state is conveyed — colour and a
 * short word are not enough on their own for a screen reader in context, so the
 * surrounding copy carries the meaning.
 */
export function Badge({ tone = 'neutral', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-2 py-0.5 font-body text-xs font-bold',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface SkeletonProps {
  readonly className?: string;
}

/**
 * A loading placeholder.
 *
 * `aria-hidden` because a screen reader should hear the region's own busy state, not a
 * description of grey rectangles. The pulse stops under reduced motion.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block animate-pulse rounded-md bg-surface-alt motion-reduce:animate-none',
        className,
      )}
    />
  );
}

export interface SkipLinkProps {
  /** Id of the main landmark, without the `#`. */
  readonly targetId?: string;
  readonly children?: ReactNode;
}

/**
 * The skip-to-content link.
 *
 * First tabbable element in the document, hidden until focused. Without it, a keyboard
 * user tabs through the entire header — nav, search, account, bell, cart — on every page
 * before reaching the content.
 */
export function SkipLink({
  targetId = 'main-content',
  children = 'Skip to content',
}: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        'sr-only rounded-md bg-primary px-4 py-2 font-body font-semibold text-primary-on',
        // focus:not-sr-only reveals it only when focused.
        'focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-100',
        FOCUS_RING,
      )}
    >
      {children}
    </a>
  );
}
