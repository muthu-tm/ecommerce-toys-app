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

  // Dev only: allow the client bundle + HMR websocket to load whether the backoffice is
  // reached at `localhost` or `127.0.0.1`. Without this, Next 16 blocks its dev resources
  // cross-origin and no client component hydrates — the access gate is stuck on "Loading…".
  // No effect on a production build. (See the storefront config for the full rationale.)
  allowedDevOrigins: ['localhost', '127.0.0.1'],

  typescript: { ignoreBuildErrors: false },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.firebasestorage.app' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
    formats: ['image/avif', 'image/webp'],
    // Same posture as the storefront: allow the same-origin SVG placeholders through
    // next/image, sandboxed and script-free. Real media is raster from the finalize pipeline.
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
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
