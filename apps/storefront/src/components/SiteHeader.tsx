import Link from 'next/link';

import { content, features } from '@/lib/store';

import { CartBadge } from './CartBadge';
import { MobileNav } from './MobileNav';
import { NotificationBell } from './NotificationBell';
import { Wordmark } from './Wordmark';

/**
 * The storefront header.
 *
 * A server component, so the nav, the store's copy and the wordmark are in the initial
 * HTML. Only the mobile menu is a client island.
 *
 * The nav is built from configured categories filtered by `showInNav`, and the age links
 * from configured bands — so a second store's navigation is its own without a code change.
 *
 * Cart and notification counts are placeholders here. They need a session and a live
 * subscription, which arrive in Tasks 11 and 15; the header is where they will mount.
 */

interface SearchLabels {
  readonly label: string;
  readonly placeholder: string;
}

const SEARCH: SearchLabels = {
  // Not store config: these are UI affordance strings, not brand voice. If a store needs
  // to translate them, they move into `content` — see WHITE_LABEL.md on adding a value.
  label: 'Search toys',
  placeholder: 'Search toys…',
};

export function SiteHeader() {
  const navItems = content.categories
    .filter((category) => category.showInNav)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((category) => ({ label: category.name, href: `/c/${category.slug}` }));

  const ageItems = content.ageBands.map((band) => ({
    label: band.label,
    href: `/age/${band.value}`,
  }));

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-page/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-4 lg:px-6">
        <MobileNav
          items={navItems}
          ageItems={ageItems}
          ageSectionTitle={content.home.ageSectionTitle}
        />

        {/* The mark on narrow viewports, the full wordmark from `sm` up. */}
        <Wordmark compact className="shrink-0 sm:hidden" />
        <Wordmark className="hidden shrink-0 sm:block" />

        <nav aria-label="Categories" className="ml-2 hidden md:block">
          <ul className="flex items-center gap-1">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded-md px-3 font-body text-sm font-semibold text-text-secondary hover:bg-surface-alt hover:text-text-primary"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Pushes the actions right without a fragile margin. */}
        <div className="flex-1" />

        <form action="/search" role="search" className="hidden lg:block">
          {/*
            A real label rather than a placeholder. A placeholder is not an accessible
            name, and it disappears as soon as the user types.
          */}
          <label htmlFor="site-search" className="sr-only">
            {SEARCH.label}
          </label>
          <input
            id="site-search"
            name="q"
            type="search"
            placeholder={SEARCH.placeholder}
            className="min-h-11 w-56 rounded-pill border border-border-strong bg-surface px-4 font-body text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          />
        </form>

        <Link
          href="/account"
          aria-label="Your account"
          className="inline-flex size-11 items-center justify-center rounded-md text-text-primary hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="none">
            <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="2" />
            <path d="M4 17c1.5-3 4-4 6-4s4.5 1 6 4" stroke="currentColor" strokeWidth="2" />
          </svg>
        </Link>

        {/*
          The live notification bell. `uid` is null until client auth lands (Task 20), so
          for now it renders the signed-out affordance — a link to the account area. The
          subscription, unread badge, day-grouped feed and mark-read all activate the moment
          a uid is supplied.
        */}
        <NotificationBell uid={null} />

        <Link
          href="/cart"
          aria-label="Your bag"
          className="relative inline-flex size-11 items-center justify-center rounded-md text-text-primary hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="none">
            <path
              d="M4 6h12l-1 9H5L4 6zM7 6V5a3 3 0 016 0v1"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          <CartBadge />
        </Link>

        {features.wishlist ? (
          <Link
            href="/account/wishlist"
            aria-label="Saved toys"
            className="hidden size-11 items-center justify-center rounded-md text-text-primary hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring sm:inline-flex"
          >
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="none">
              <path
                d="M10 16S3.5 12 3.5 7.8A3.3 3.3 0 0110 6a3.3 3.3 0 016.5 1.8C16.5 12 10 16 10 16z"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </Link>
        ) : null}
      </div>
    </header>
  );
}
