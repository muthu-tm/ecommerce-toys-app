/**
 * Test stub for `@/generated/fonts`.
 *
 * The generated module calls `next/font/google`, a build-time transform whose exports are
 * not callable outside `next build`. Aliasing this app-local module in `vitest.config.ts` is
 * deterministic; that the generated module requests the right families is asserted against
 * `renderFontsModule` in `@romp/store-config`.
 */
export const fontClassName = 'font-stub-display font-stub-body';
