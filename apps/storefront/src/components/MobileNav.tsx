'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Dialog, IconButton } from '@romp/ui';

export interface NavItem {
  readonly label: string;
  readonly href: string;
}

export interface MobileNavProps {
  readonly items: readonly NavItem[];
  readonly ageItems: readonly NavItem[];
  readonly menuLabel?: string;
  readonly title?: string;
  readonly ageSectionTitle: string;
}

/**
 * The mobile navigation menu.
 *
 * A client component — it owns open/closed state — and the only one in the header. The
 * rest of the shell is server-rendered, so the header's markup and the store's copy are
 * in the initial HTML rather than arriving after hydration.
 *
 * Uses the design system's `Dialog`, which brings the focus trap, Escape handling, focus
 * restoration and scroll lock with it. Re-implementing any of that here is how a menu
 * ends up with a trap that has no exit.
 */
export function MobileNav({
  items,
  ageItems,
  menuLabel = 'Menu',
  title = 'Browse',
  ageSectionTitle,
}: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        label={menuLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
        className="md:hidden"
      >
        <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="none">
          <path
            d="M3 6h14M3 10h14M3 14h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </IconButton>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={title}
      >
        <nav aria-label={title}>
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => {
                    setOpen(false);
                  }}
                  className="block min-h-11 rounded-md px-3 py-2.5 font-body text-base font-semibold text-text-primary hover:bg-surface-alt"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <h3 className="mt-5 mb-1 px-3 font-body text-sm font-bold text-text-muted uppercase">
            {ageSectionTitle}
          </h3>
          <ul className="flex flex-col gap-1">
            {ageItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => {
                    setOpen(false);
                  }}
                  className="block min-h-11 rounded-md px-3 py-2.5 font-body text-base text-text-secondary hover:bg-surface-alt"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Dialog>
    </>
  );
}
