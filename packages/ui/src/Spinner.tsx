import { cn } from './cn';

export interface SpinnerProps {
  readonly className?: string;
  /**
   * Accessible label.
   *
   * Omitted by default because a spinner is almost always inside something that already
   * announces the busy state — a button with `aria-busy`, or a region with
   * `aria-live`. Announcing "Loading" a second time is noise. Pass a label only when
   * the spinner is the sole indication.
   */
  readonly label?: string;
}

/**
 * An indeterminate progress indicator.
 *
 * `motion-reduce:animate-none` stops the spin for users who asked for reduced motion; the
 * element stays visible, so the busy state is still conveyed.
 */
export function Spinner({ className, label }: SpinnerProps) {
  return (
    <span
      className={cn(
        'inline-block size-4 shrink-0 animate-spin rounded-pill border-2 border-current border-t-transparent motion-reduce:animate-none',
        className,
      )}
      role={label === undefined ? 'presentation' : 'status'}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
    />
  );
}
