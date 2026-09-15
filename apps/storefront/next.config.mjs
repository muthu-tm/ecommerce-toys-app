// @ts-check

/**
 * Next configuration for the storefront.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Workspace packages ship TypeScript source rather than a build, so Next compiles
  // them. That keeps the packages themselves buildless and means a change in @romp/ui is
  // picked up by dev without a rebuild step.
  transpilePackages: [
    '@romp/ui',
    '@romp/contracts',
    '@romp/core',
    '@romp/observability',
    '@romp/store-config',
  ],

  // App Hosting runs the Node server, so no static export.
  output: 'standalone',

  // Dev only: Next 16 blocks cross-origin requests to its dev resources (the HMR websocket
  // and the client JS chunks) unless the host is allow-listed. Local dev is reached at both
  // `localhost` and `127.0.0.1` — the two are different origins to the browser — so visiting
  // one while the server assumes the other blocks the client bundle, which leaves every
  // client component unhydrated (auth stuck on "Loading…", the header controls inert). Listing
  // both makes either host work. This has no effect on a production build.
  allowedDevOrigins: ['localhost', '127.0.0.1'],

  // A type error must fail the build. Next's default already does this; stating it means a
  // future `ignoreBuildErrors: true` cannot be slipped in quietly.
  //
  // There is no `eslint` key: Next 16 removed it, and linting runs as its own Turbo task
  // rather than inside the build.
  typescript: { ignoreBuildErrors: false },

  images: {
    // Product media comes from Firebase Storage, fronted by Cloudflare (ADR-0003).
    // The bucket host is environment-specific, so it is configured rather than hardcoded.
    remotePatterns: [
      { protocol: 'https', hostname: '*.firebasestorage.app' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
    // AVIF first: materially smaller than WebP on photographic product images, which is
    // the dominant payload on every page here.
    formats: ['image/avif', 'image/webp'],
    // The development catalogue placeholders are SVGs served same-origin from /media.
    // Allowing SVG through next/image is normally risky because an SVG can carry script —
    // so it is locked down: a strict CSP that forbids scripts and forces the image to be
    // treated as an attachment sandbox. Real product photography is raster (webp/avif) from
    // the finalize pipeline, never SVG, so this only ever applies to our own trusted assets.
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  // Security headers. Duplicated at the edge in Task 23; kept here so they hold even for
  // a request that bypasses Cloudflare.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },

  // Cheap wins that are easy to forget later.
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
