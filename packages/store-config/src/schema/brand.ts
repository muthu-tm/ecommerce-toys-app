import { z } from 'zod';

/**
 * Brand identity.
 *
 * This is the "product name" the requirement asks to be configurable: the store's own
 * name and wordmark, not the names of catalogue products.
 */
export const BrandSchema = z.object({
  /**
   * Must equal the directory name under `stores/`. Checked by the loader, which is
   * the only place that knows the directory it read from.
   */
  id: z.string().regex(/^_?[a-z][a-z0-9-]*$/u, {
    error:
      'A store ID is lowercase alphanumeric with hyphens, e.g. "toybox". A leading underscore is reserved for scaffolds.',
  }),
  /** Wordmark and page titles. */
  name: z.string().min(1).max(60),
  /** Invoices and policy pages. */
  legalName: z.string().min(1).max(200),
  tagline: z.string().min(1).max(200),
  /**
   * Prefix for customer-facing order numbers and the UPI payment note: `RMP` gives
   * `RMP-24817`. Uppercase so the generated order number matches `HumanOrderIdSchema`
   * in `@romp/contracts`, which a second store's prefix must satisfy too.
   */
  orderPrefix: z.string().regex(/^[A-Z]{2,8}$/u, {
    error: 'An order prefix is 2–8 uppercase letters, e.g. "RMP".',
  }),
  logos: z.object({
    /** Wordmark for dark surfaces. */
    dark: z.string().min(1),
    light: z.string().min(1),
    /** Square mark, for the mobile header and as the favicon source. */
    mark: z.string().min(1),
    favicon: z.string().min(1),
  }),
  /** 1200×630 social image, used when a page has none of its own. */
  ogFallback: z.string().min(1),
});
export type Brand = z.infer<typeof BrandSchema>;

/** Every asset path in the config, for the loader's existence check. */
export function brandAssetPaths(brand: Brand): readonly string[] {
  return [
    brand.logos.dark,
    brand.logos.light,
    brand.logos.mark,
    brand.logos.favicon,
    brand.ogFallback,
  ];
}
