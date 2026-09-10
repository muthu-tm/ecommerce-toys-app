'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

import { cn } from './cn';
import { FOCUS_RING, tabbableElements } from './focus';
import { IconButton } from './IconButton';
import { TRANSITION } from './motion';

/**
 * A modal dialog.
 *
 * "Keyboard traps handled" cuts both ways, and the distinction is the whole point of
 * this component:
 *
 *  - A modal **must** trap Tab, or a keyboard user tabs out of the dialog into the page
 *    behind it, which they cannot see and which is supposed to be inert.
 *  - It must **not** trap the user, so Escape always closes, the trap is removed on
 *    unmount, and focus returns to whatever opened it.
 *
 * An accessible modal is a checklist, and every item here is a thing that breaks for
 * somebody if it is missing:
 *
 *  1. `role="dialog"` + `aria-modal="true"`.
 *  2. `aria-labelledby` pointing at the visible title, so it is announced on open.
 *  3. Focus moves into the dialog on open, and to the first tabbable element rather than
 *     the container, so the first Tab is not a no-op.
 *  4. Focus is restored to the trigger on close, or the user is dumped at the top of the
 *     document with no idea where they were.
 *  5. Tab cycles within the dialog, in both directions.
 *  6. Escape closes.
 *  7. Background scroll is locked, so the page does not move underneath.
 *  8. A click on the backdrop closes, but a drag that *ends* on the backdrop does not —
 *     selecting text in the dialog and releasing outside should not discard it.
 */

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  /** Footer actions. Rendered after the content, inside the trap. */
  readonly footer?: ReactNode;
  readonly closeLabel?: string;
  readonly className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = 'Close',
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const pointerDownOnBackdrop = useRef(false);
  const titleId = `dialog-${useId()}`;

  // Move focus in on open, and put it back on close.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    if (panel !== null) {
      const focusables = tabbableElements(panel);
      // The first tabbable element, not the panel — focusing the container means the
      // user's first Tab appears to do nothing.
      (focusables[0] ?? panel).focus();
    }

    return () => {
      previouslyFocused.current?.focus();
    };
  }, [open]);

  // Lock background scroll. Restores the previous value rather than clearing it, so
  // nesting or a page that already locked scrolling is not broken on close.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (panel === null) return;

      const focusables = tabbableElements(panel);
      if (focusables.length === 0) {
        // Nothing to move to; keep focus where it is rather than letting it escape.
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables.at(-1);
      if (first === undefined || last === undefined) return;

      // Wrap at both ends. Without the Shift branch, Shift+Tab from the first element
      // walks straight out of the dialog.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      onKeyDown={onKeyDown}
    >
      {/*
        Presentational: the backdrop is not the accessible close control. The close
        button and Escape are. A keyboard user must never need to click a backdrop.
      */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-surface-deep/80"
        onPointerDown={() => {
          pointerDownOnBackdrop.current = true;
        }}
        onPointerUp={() => {
          if (pointerDownOnBackdrop.current) onClose();
          pointerDownOnBackdrop.current = false;
        }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto',
          'rounded-t-lg bg-surface p-5 shadow-overlay sm:max-w-lg sm:rounded-lg',
          TRANSITION,
          className,
        )}
        onPointerDown={() => {
          // A drag that started inside must not close on release outside.
          pointerDownOnBackdrop.current = false;
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-xl text-text-primary">
            {title}
          </h2>
          <IconButton label={closeLabel} onClick={onClose} className={FOCUS_RING}>
            {/* aria-hidden: the accessible name comes from IconButton's label. */}
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="none">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </IconButton>
        </div>

        <div className="font-body text-base text-text-secondary">{children}</div>

        {footer === undefined ? null : (
          <div className="flex flex-wrap justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
}
