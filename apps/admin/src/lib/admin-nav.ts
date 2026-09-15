/**
 * Backoffice section list.
 *
 * Shared by the sidebar and its tests so a path change cannot silently desync the
 * highlight from the link. Labels are UI chrome ("Overview", "Orders"), not brand voice.
 * Only routes that exist are listed — Discounts / Customers / Team / Settings from the
 * prototype are not stubbed as dead links.
 */

export interface AdminNavItem {
  readonly href: string;
  readonly label: string;
}

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/orders', label: 'Orders' },
  { href: '/', label: 'Products' },
  { href: '/categories', label: 'Categories' },
  { href: '/reviews', label: 'Reviews' },
];

/** True when `href` is the section the current path belongs to. */
export function isAdminNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/products');
  return pathname === href || pathname.startsWith(`${href}/`);
}
