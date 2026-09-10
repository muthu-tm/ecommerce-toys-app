import type { Metadata, Viewport } from 'next';

import { SkipLink } from '@romp/ui';

import './globals.css';
import { AdminHeader } from '@/components/AdminHeader';
import { fontClassName } from '@/generated/fonts';
import { brand, locale, theme } from '@/lib/store';

/**
 * The backoffice root layout.
 *
 * Brand-shaped values are configuration, the same as the storefront: the title, the favicon
 * and the fonts come from the store config, so a second store's backoffice announces itself
 * as that store. The title names it a backoffice so a staff member's browser tab is
 * unambiguous, but the store name is interpolated rather than hardcoded.
 */
export const metadata: Metadata = {
  title: {
    default: `${brand.name} backoffice`,
    template: `%s · ${brand.name} backoffice`,
  },
  description: `Catalogue and store operations for ${brand.name}.`,
  applicationName: `${brand.name} backoffice`,
  icons: { icon: '/brand/favicon.svg' },
  // The backoffice must never be indexed — it is a private surface.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: theme.colors.surfaceDeep,
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang={locale.locale} className={fontClassName}>
      <body className="min-h-dvh antialiased">
        <SkipLink />
        <AdminHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 lg:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}
