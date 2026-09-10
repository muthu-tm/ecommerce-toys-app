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
