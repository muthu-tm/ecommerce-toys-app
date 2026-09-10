// @ts-check

/**
 * Next configuration for the backoffice.
 *
 * Mirrors the storefront's: workspace packages ship TypeScript source and are transpiled,
 * the App Hosting runtime serves a standalone Node build, type errors fail the build, and
 * product media is loaded from the Firebase Storage host through `next/image`. The admin is
 * a separate App Hosting backend on its own subdomain (`admin.<domain>`), so it has its own
 * config rather than sharing the storefront's.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  transpilePackages: [
    '@romp/ui',
    '@romp/contracts',
    '@romp/core',
    '@romp/observability',
    '@romp/store-config',
  ],

  output: 'standalone',

  typescript: { ignoreBuildErrors: false },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.firebasestorage.app' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // The backoffice is never meant to be framed — clickjacking a publish control is a
          // real risk. Hardened further at the edge in Task 23.
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },

  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
