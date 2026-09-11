import type { Metadata, Viewport } from 'next';

import { SkipLink } from '@romp/ui';

import './globals.css';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { fontClassName } from '@/generated/fonts';
import { AuthProvider } from '@/lib/auth-context';
import { brand, locale, theme } from '@/lib/store';

/**
 * The root layout.
 *
 * Everything brand-shaped here is configuration: the title template, the description, the
 * favicon, the OG fallback and the fonts. `fontClassName` comes from the generated font
 * module, because `next/font` is statically analysed and cannot take a family name from a
 * config object at runtime.
 */

/**
 * Absolute base for OG and canonical URLs.
 *
 * Environment rather than store config: the same store has different hostnames per
 * environment, so this is deployment configuration, not brand configuration. Without it
 * Next resolves social images against `localhost`, and every share preview breaks in
 * production while looking fine locally.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    // Page titles become "Wooden blocks · ROMP" without every page repeating the name.
    template: `%s · ${brand.name}`,
  },
  description: brand.tagline,
  applicationName: brand.name,
  icons: { icon: '/brand/favicon.svg' },
  openGraph: {
    type: 'website',
    siteName: brand.name,
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.tagline,
    images: [{ url: '/brand/og-fallback.png', width: 1200, height: 630, alt: brand.name }],
  },
  twitter: { card: 'summary_large_image' },
  // Per-page canonicals are set in Task 22 alongside the sitemap.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately no maximumScale or userScalable: false. Blocking zoom is a WCAG
  // failure, and pinch-zoom is how people read small print on a phone.
  //
  // From config, not a literal: the browser chrome should match the store's own darkest
  // surface, and the lint rule correctly refused the hardcoded hex that was here.
  themeColor: theme.colors.surfaceDeep,
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    // lang from config, so a store serving another locale announces itself correctly to
    // screen readers and translation tools.
    <html lang={locale.locale} className={fontClassName}>
      <body className="min-h-dvh antialiased">
        {/* First tabbable element, so a keyboard user is not marched through the header. */}
        <SkipLink />
        {/*
          One auth subscription for the whole tree — the header's bell and the account pages read
          the same `{ uid, ready }` rather than each wiring their own listener.
        */}
        <AuthProvider>
          <SiteHeader />
          {/*
            `main` with an id is the skip-link target and the page's primary landmark.
            tabIndex={-1} makes it programmatically focusable so the skip actually moves
            focus rather than only scrolling.
          */}
          <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 lg:px-6">
            {children}
          </main>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
