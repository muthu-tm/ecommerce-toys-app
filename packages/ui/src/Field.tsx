import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from './cn';
import { FOCUS_RING } from './focus';
import { TRANSITION } from './motion';

/**
 * A labelled form control.
 *
 * The whole reason this exists as one component rather than a `Label` and an `Input` you
 * assemble yourself: the wiring between them is where accessibility breaks. Getting
 * `htmlFor`/`id`, `aria-describedby` and `aria-invalid` right is mechanical, so it should
 * be done once, here, and be impossible to forget at a call site.
 *
 * What it guarantees:
 *
 *  - The label is always associated with the control, via a generated id.
 *  - Hint and error text are referenced by `aria-describedby`, so a screen reader reads
 *    them as part of the field rather than as loose text nearby.
 *  - An invalid field sets `aria-invalid`, so the error is conveyed by more than colour.
 *  - The error is in an `aria-live` region, so a validation failure arriving after submit
 *    is announced rather than appearing silently.
 */

export interface FieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'id'
> {
  readonly label: string;
  /** Supporting text shown under the control. */
  readonly hint?: string;
  /** Error message. Its presence marks the field invalid. */
  readonly error?: string;
  /**
   * Hides the label visually while keeping it for assistive technology.
   *
   * For a search box whose purpose is obvious from context. Use sparingly: a visible
   * label is better for everyone, including sighted users with cognitive load.
   */
  readonly labelHidden?: boolean;
  readonly className?: string;
  readonly inputClassName?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, labelHidden = false, className, inputClassName, required, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = `field-${generatedId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={inputId}
        className={cn(
          'font-body text-sm font-semibold text-text-primary',
          labelHidden && 'sr-only',
        )}
      >
        {label}
        {required === true ? (
          <>
            {' '}
            <span className="text-accent" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </label>

      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(
          'min-h-11 rounded-md border bg-surface px-3 font-body text-base text-text-primary',
          'placeholder:text-text-muted disabled:opacity-50',
          error === undefined ? 'border-border-strong' : 'border-danger',
          TRANSITION,
          FOCUS_RING,
          inputClassName,
        )}
        {...rest}
      />

      {hint === undefined ? null : (
        <p id={hintId} className="font-body text-sm text-text-muted">
          {hint}
        </p>
      )}

      {/*
        Always rendered, so the live region exists before the error does. A region
        inserted at the same moment as its content is often not announced.
      */}
      <p
        id={errorId}
        role="alert"
        aria-live="polite"
        className={cn('font-body text-sm text-danger', error === undefined && 'hidden')}
      >
        {error}
      </p>
    </div>
  );
});

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
}

/** Content for assistive technology only. Still focusable and still read aloud. */
export function VisuallyHidden({ children }: VisuallyHiddenProps) {
  return <span className="sr-only">{children}</span>;
}
