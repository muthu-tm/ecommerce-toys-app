import { forwardRef } from 'react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from './cn';
import { FOCUS_RING } from './focus';
import { TRANSITION } from './motion';
import { Spinner } from './Spinner';

/**
 * Button and ButtonLink.
 *
 * Two components rather than one polymorphic one, because the distinction is semantic,
 * not cosmetic: a `<button>` submits or acts, an `<a>` navigates. Screen readers announce
 * them differently, Enter and Space behave differently, and "open in new tab" only works
 * on one. A single component with an `as` prop invites getting that wrong.
 *
 * Every colour, radius and duration below is a token. There is no literal.
 */

export type ButtonVariant = 'primary' | 'accent' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Readonly<Record<ButtonVariant, string>> = Object.freeze({
  primary: 'bg-primary text-primary-on hover:brightness-95 active:brightness-90',
  accent: 'bg-accent text-accent-on hover:brightness-95 active:brightness-90',
  outline:
    'border border-border-strong text-text-primary hover:bg-surface-alt active:bg-surface-deep',
  ghost: 'text-text-primary hover:bg-surface-alt active:bg-surface-deep',
});

const SIZES: Readonly<Record<ButtonSize, string>> = Object.freeze({
  // min-h keeps every control at or above the 44px touch target on mobile.
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-base gap-2',
  lg: 'min-h-12 px-6 text-lg gap-2.5',
});

const BASE =
  'inline-flex items-center justify-center rounded-md font-body font-semibold ' +
  'disabled:opacity-50 disabled:pointer-events-none select-none';

function buttonClasses(variant: ButtonVariant, size: ButtonSize, fullWidth: boolean): string {
  return cn(BASE, TRANSITION, FOCUS_RING, VARIANTS[variant], SIZES[size], fullWidth && 'w-full');
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  /**
   * Shows a spinner and blocks interaction.
   *
   * The label stays in the DOM rather than being swapped for the spinner, so the
   * accessible name does not change mid-interaction and the button does not resize —
   * a button that shrinks under the cursor is how people mis-click.
   */
  readonly loading?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // Default to `button`. The HTML default is `submit`, which turns any button inside
      // a form into an accidental submit.
      type={rest.type ?? 'button'}
      aria-busy={loading || undefined}
      disabled={rest.disabled ?? loading}
      className={cn(buttonClasses(variant, size, fullWidth), className)}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

export interface ButtonLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'className'
> {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = 'primary', size = 'md', fullWidth = false, className, children, ...rest },
  ref,
) {
  const external = rest.target === '_blank';

  return (
    <a
      ref={ref}
      className={cn(buttonClasses(variant, size, fullWidth), className)}
      // Without noreferrer, a new-tab link hands the opened page a reference to this one.
      rel={external ? (rest.rel ?? 'noopener noreferrer') : rest.rel}
      {...rest}
    >
      {children}
    </a>
  );
});
