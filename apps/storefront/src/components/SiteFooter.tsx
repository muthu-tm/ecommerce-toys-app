import Link from 'next/link';

import { buildWhatsappLink } from '@romp/store-config';

import { brand, contact, content } from '@/lib/store';

import { Wordmark } from './Wordmark';

/**
 * The storefront footer.
 *
 * Columns, links and the legal line all come from `content.footer`, so a second store's
 * footer is entirely its own.
 *
 * The support link is a WhatsApp deep link built by `buildWhatsappLink` from the
 * configured number and greeting — support is WhatsApp, because the platform sends no
 * email (ADR-0007).
 */
export function SiteFooter() {
  const supportHref = buildWhatsappLink(contact);

  return (
    <footer className="mt-16 border-t border-border bg-surface-deep">
      <div className="mx-auto max-w-7xl px-4 py-10 lg:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <Wordmark />
            <p className="mt-3 font-body text-sm text-text-secondary">{brand.tagline}</p>

            <a
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-pill bg-primary px-4 font-body text-sm font-bold text-primary-on focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true" fill="currentColor">
                <path d="M10 2a8 8 0 00-6.9 12l-1 3.6 3.7-1A8 8 0 1010 2z" />
              </svg>
              Chat on WhatsApp
              {/*
                The new tab is announced, so it is not a surprise. The explicit space
                matters: without it the accessible name is "WhatsApp(opens in a new tab)",
                because JSX drops the whitespace before an element.
              */}{' '}
              <span className="sr-only">(opens in a new tab)</span>
            </a>

            <p className="mt-2 font-body text-xs text-text-muted">{contact.supportHours}</p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {content.footer.columns.map((column) => (
              <div key={column.title}>
                <h2 className="font-body text-sm font-bold text-text-primary">{column.title}</h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="font-body text-sm text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <p className="mt-10 border-t border-border pt-6 font-body text-xs text-text-muted">
          {content.footer.legalLine}
        </p>
      </div>
    </footer>
  );
}
