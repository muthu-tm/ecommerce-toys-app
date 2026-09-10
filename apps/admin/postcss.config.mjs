/**
 * Tailwind 4 is a PostCSS plugin and needs no JavaScript config — the theme is declared in
 * CSS, in the `@theme` block that `pnpm store:tokens` generates from the store config.
 *
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
