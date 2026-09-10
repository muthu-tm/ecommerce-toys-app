/**
 * Test stub for `@/generated/fonts`.
 *
 * The generated module calls `next/font/google`, which is a build-time transform: outside
 * `next build` its exports are not callable. Rather than fight Vitest's module
 * externalisation to intercept a `node_modules` import, the seam is the app-local
 * generated module itself, aliased in `vitest.config.ts`.
 *
 * What this stub does *not* weaken: that the generated module requests the right families,
 * weights, variables and `display: swap` is asserted directly against
 * `renderFontsModule` in `@romp/store-config`. Here the only thing that matters is that
 * the layout puts the class it is given onto `<html>`.
 */
export const fontClassName = 'font-stub-display font-stub-body';
