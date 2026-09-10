/**
 * The ISR cache-tag vocabulary, shared by the read side and the write side.
 *
 * Every ISR-cached read is tagged, and a catalogue write revalidates the matching tags.
 * Keeping the tags in one place, built by functions rather than assembled inline, is what
 * stops a read tagging `product:wooden-blocks` while a write revalidates
 * `products:wooden-blocks` — a mismatch that does not error. It just serves a stale page
 * forever, which is the worst kind of caching bug because the code looks correct.
 *
 * This lives in `@romp/core` because both surfaces import it and neither can import the
 * other: the storefront (a Next app) tags its reads with it, and the API (a Fastify service
 * that cannot import `next`) reads it to know what to revalidate after a write. Pure, no
 * Firebase, no `next` — the property that lets it be the single source both sides trust.
 *
 * The granularity is deliberate. `catalogue` is the coarse tag a bulk change busts
 * wholesale; `product(slug)` and `category(slug)` are the fine tags a single edit busts, so
 * publishing one product does not cold-start every listing page in the store.
 */
export const cacheTags = {
  /** Everything catalogue-shaped. Bust it for a change with store-wide reach. */
  catalogue: 'catalogue',

  /** One product's detail page. Bust it when that product is edited. */
  product: (slug: string): string => `product:${slug}`,

  /** One category's listing page. Bust it when a product enters or leaves it. */
  category: (slug: string): string => `category:${slug}`,

  /** One age band's listing page. */
  ageBand: (value: string): string => `age:${value}`,

  /** The category tree itself — nav and sidebar. Bust it when categories change shape. */
  categories: 'categories',
} as const;

/**
 * The tags a single product's publication or edit invalidates.
 *
 * A helper rather than a list assembled at each call site, because a product edit has to
 * bust the product page, its category listing, its age-band listing, and the coarse
 * catalogue tag — and forgetting one of those is the stale-page bug this module exists to
 * prevent. The product-write path calls this.
 */
export function tagsForProduct(product: {
  readonly slug: string;
  readonly categorySlug: string;
  readonly ageBand: string;
}): readonly string[] {
  return [
    cacheTags.product(product.slug),
    cacheTags.category(product.categorySlug),
    cacheTags.ageBand(product.ageBand),
    cacheTags.catalogue,
  ];
}
