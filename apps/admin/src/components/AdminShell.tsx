'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Button, Dialog, IconButton, ThemeToggle } from '@romp/ui';

import { ADMIN_NAV, isAdminNavActive } from '@/lib/admin-nav';
import { signOutOperator } from '@/lib/auth';
import { useAuth } from '@/lib/auth-context';
import { brand, locale } from '@/lib/store';

/**
 * Backoffice chrome: a left rail when an operator is signed in, a slim bar otherwise.
 *
 * Matches the prototype admin shell (`ROMP Toy Store.html`): brand mark, section list,
 * operator identity at the bottom. The login screen has no section links — there is
 * nothing a signed-out visitor can reach. On a phone the rail becomes a labelled dialog.
 */

export function AdminShell({ children }: { readonly children: ReactNode }) {
  const { operator } = useAuth();
  const signedIn = operator?.kind === 'operator';

  if (!signedIn) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between gap-3 px-4 py-4 lg:px-6">
          <BrandMark />
          <ThemeToggle />
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    );
  }

  const roleLabel = operator.role === 'owner' ? 'Owner' : 'Staff';

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-surface-deep px-3.5 py-5 lg:flex">
        <BrandMark />
        <AdminNav />
        <div className="mt-auto flex flex-col gap-3">
          <ThemeToggle className="self-start" />
          <OperatorFooter roleLabel={roleLabel} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar roleLabel={roleLabel} />
        <div className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </div>
    </div>
  );
}

function BrandMark() {
  const initial = brand.name.slice(0, 1).toUpperCase();
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-1.5">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary font-display text-sm text-primary-on"
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-display text-sm text-text-primary">{brand.name} Admin</span>
        <span className="font-body text-[0.7rem] text-text-muted">
          {locale.defaultPhoneRegion} store
        </span>
      </span>
    </Link>
  );
}

function AdminNav({ onNavigate }: { readonly onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Backoffice sections">
      <ul className="flex flex-col gap-0.5">
        {ADMIN_NAV.map((item) => {
          const active = isAdminNavActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                // Spread `onClick` only when supplied: `exactOptionalPropertyTypes` forbids
                // passing `undefined` to Link's non-optional `onClick`.
                {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
                className={
                  active
                    ? 'block rounded-lg bg-primary/15 px-3 py-2.5 font-body text-sm font-extrabold text-primary'
                    : 'block rounded-lg px-3 py-2.5 font-body text-sm font-semibold text-text-secondary hover:bg-surface-alt hover:text-text-primary'
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function OperatorFooter({ roleLabel }: { readonly roleLabel: string }) {
  const initial = roleLabel.slice(0, 1);

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center gap-2.5 px-1.5">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-surface-alt font-body text-xs font-bold text-text-primary"
        >
          {initial}
        </span>
        <span className="font-body text-xs font-semibold text-text-secondary">{roleLabel}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        fullWidth
        onClick={() => {
          void signOutOperator();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

function MobileBar({ roleLabel }: { readonly roleLabel: string }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="flex items-center gap-2 border-b border-border px-3 py-3 lg:hidden">
      <IconButton
        label="Menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
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
      <BrandMark />
      <div className="flex-1" />
      <ThemeToggle />
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Backoffice"
      >
        <div className="flex flex-col gap-4">
          <AdminNav
            onNavigate={() => {
              setOpen(false);
            }}
          />
          <OperatorFooter roleLabel={roleLabel} />
        </div>
      </Dialog>
    </header>
  );
}
