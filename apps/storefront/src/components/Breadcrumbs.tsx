import Link from 'next/link';

/**
 * A breadcrumb trail.
 *
 * A real `nav > ol` with an accessible label and `aria-current` on the last crumb, not a
 * row of divs — a screen-reader user should hear "breadcrumb navigation, list, 3 items"
 * and know where the current page sits, and the visual separator is decorative so it is
 * never announced.
 *
 * The last crumb is the current page and is not a link: linking a page to itself is a
 * dead control, and `aria-current="page"` is the right way to mark "you are here". Every
 * label is passed in, so no copy lives here — the "Home" label comes from store config at
 * the call site.
 */
export interface Crumb {
  readonly label: string;
  /** Absent on the current page — the last crumb renders as text, not a link. */
  readonly href?: string;
}

export interface BreadcrumbsProps {
  readonly items: readonly Crumb[];
  /** Accessible name for the nav landmark; from config so it reads in the store's language. */
  readonly label: string;
}

export function Breadcrumbs({ items, label }: BreadcrumbsProps) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-1 font-body text-sm text-text-muted">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${crumb.label}-${String(index)}`} className="flex items-center gap-1">
              {crumb.href !== undefined && !isLast ? (
                <Link
                  href={crumb.href}
                  className="rounded-sm hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className="text-text-primary">
                  {crumb.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden="true" className="text-text-muted">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
