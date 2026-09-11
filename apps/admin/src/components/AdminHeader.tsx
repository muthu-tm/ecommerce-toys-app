import Link from 'next/link';

import { brand } from '@/lib/store';

/**
 * The backoffice header.
 *
 * Minimal by design — the backoffice is a tool, not a storefront. The store name comes from
 * config so a second store's backoffice is branded as that store; "Backoffice" is a plain
 * affordance label, not brand voice, so it is a literal.
 */
export function AdminHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 lg:px-6">
        <Link href="/" className="font-display text-lg text-text-primary">
          {brand.name}
          <span className="ml-2 font-body text-sm font-normal text-text-muted">Backoffice</span>
        </Link>
        <nav aria-label="Backoffice sections" className="flex items-center gap-4">
          <Link href="/" className="font-body text-sm text-text-primary hover:text-accent">
            Products
          </Link>
          <Link
            href="/categories"
            className="font-body text-sm text-text-primary hover:text-accent"
          >
            Categories
          </Link>
          <Link href="/orders" className="font-body text-sm text-text-primary hover:text-accent">
            Orders
          </Link>
          <Link href="/dashboard" className="font-body text-sm text-text-primary hover:text-accent">
            Dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
}
