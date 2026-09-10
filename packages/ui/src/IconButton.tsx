import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from './cn';
import { FOCUS_RING } from './focus';
import { TRANSITION } from './motion';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'aria-label'
> {
  /**
   * The accessible name. **Required**, not optional.
   *
   * An icon-only button with no label is announced as "button" and is the single most
   * common accessibility defect in a commerce UI — it is every close, wishlist, menu and
   * cart control. Making the prop required means it cannot be forgotten, only done badly.
   */
  readonly label: string;
  /** Badge count, e.g. cart items or unread notifications. */
  readonly badge?: number;
  readonly className?: string;
  readonly children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, badge, className, children, ...rest },
  ref,
) {
  // Capped so a runaway count cannot break the layout.
  const badgeText = badge === undefined || badge <= 0 ? null : badge > 99 ? '99+' : String(badge);

  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      aria-label={
        // The count belongs in the accessible name. A visual "3" next to a "Cart" label
        // tells a sighted user how many items there are and tells a screen-reader user
        // nothing.
        badgeText === null ? label : `${label} (${badgeText})`
      }
      className={cn(
        'relative inline-flex size-11 items-center justify-center rounded-md text-text-primary',
        'hover:bg-surface-alt active:bg-surface-deep disabled:opacity-50 disabled:pointer-events-none',
        TRANSITION,
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {children}
      {badgeText === null ? null : (
        <span
          // Hidden from assistive tech: already in the button's accessible name above.
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 min-w-5 rounded-pill bg-accent px-1 text-center font-body text-xs font-bold text-accent-on"
        >
          {badgeText}
        </span>
      )}
    </button>
  );
});
