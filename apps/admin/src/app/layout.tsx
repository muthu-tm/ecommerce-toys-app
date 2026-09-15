import type { Metadata, Viewport } from 'next';

import { SkipLink, ThemeProvider, themeInitScript } from '@romp/ui';

import './globals.css';
import { AdminGate } from '@/components/AdminGate';
import { AdminShell } from '@/components/AdminShell';
import { fontClassName } from '@/generated/fonts';
import { AuthProvider } from '@/lib/auth-context';
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
    <html lang={locale.locale} className={fontClassName} suppressHydrationWarning>
      <head>
        {/* No-flash theme script — see the storefront layout for the rationale. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <SkipLink />
        <ThemeProvider>
          {/*
            One auth subscription for the whole backoffice. The shell reads it to show the
            sidebar for an operator; the gate reads it to decide login / not-permitted / app.
          */}
          <AuthProvider>
            <AdminShell>
              <main id="main-content" tabIndex={-1}>
                <AdminGate>{children}</AdminGate>
              </main>
            </AdminShell>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
