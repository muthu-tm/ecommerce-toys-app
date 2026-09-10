import type { ProductSummary } from '@romp/contracts';

/**
 * A product summary for a component test.
 *
 * Not `@romp/contracts/fixtures` — those build full `ProductDoc`s, and a card test wants a
 * card projection with the fields spelled out so an assertion reads against a known value
 * rather than a fixture's incidental one.
 */
export function aSummary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: 'wooden-blocks' as ProductSummary['id'],
    slug: 'wooden-blocks' as ProductSummary['slug'],
    name: 'Wooden building blocks',
    brand: 'Woodwise',
    categorySlug: 'building-sets' as ProductSummary['categorySlug'],
    ageBand: '6-8' as ProductSummary['ageBand'],
    badge: null,
    priceFromMinor: 129_900 as ProductSummary['priceFromMinor'],
    mrpFromMinor: 149_900 as ProductSummary['mrpFromMinor'],
    ratingAvg: 4.6,
    ratingCount: 18,
    cover: {
      path: 'products/wooden-blocks/cover.webp',
      alt: 'A tower of beechwood blocks',
      width: 1_200,
      height: 1_200,
      blurhash: null,
    },
    inStock: true,
    variantCount: 2,
    ...overrides,
  };
}
