import { defineCatalogueSeed } from '@romp/store-config';

/**
 * Starter catalogue for a new store.
 *
 * Two products, deliberately: one with a single variant and one with two, across
 * both a top-level and a nested category, one warehouse, and one variant seeded out
 * of stock. That is the smallest set that exercises every branch of the seed — and
 * because `_template` is also the second configuration CI builds, it is the set that
 * proves the seed is not accidentally shaped around ROMP's catalogue.
 *
 * Replace it with your own products. The rules:
 *
 *   - `category` is a slug from `content.categories` in `store.config.ts`.
 *   - `ageBand` is a value from `content.ageBands`.
 *   - every `stock` key is a `code` from `warehouses`.
 *   - prices are **paise**: `49900` is ₹499.00.
 *
 * `pnpm seed` reports every broken reference in one pass, so you do not need to fix
 * them one run at a time.
 */
export default defineCatalogueSeed({
  products: [
    {
      slug: 'sample-product-one',
      name: 'Sample product one',
      description:
        'Replace this description. Two or three sentences is right — enough to say what it is and who it is for, short enough that someone reads it on a phone.',
      brand: 'Your brand',
      category: 'category-one',
      ageBand: '2-4',
      badge: 'Bestseller',
      featured: true,
      skills: ['replace this skill', 'and this one'],
      boxItems: ['Replace this line', 'And this one'],
      safety: {
        bisCertified: false,
        bisCertNo: null,
        bisCertExpiry: null,
        bpaFree: true,
        hasSmallParts: false,
      },
      variants: [
        {
          name: 'Standard',
          sku: 'SAMPLE-001-STD',
          priceMinor: 49_900,
          mrpMinor: 59_900,
          options: { size: 'standard' },
          weightGrams: 500,
          stock: { main: 20 },
        },
        {
          name: 'Large',
          sku: 'SAMPLE-001-LRG',
          priceMinor: 79_900,
          mrpMinor: 89_900,
          options: { size: 'large' },
          weightGrams: 900,
          // Out of stock on purpose, so the out-of-stock state is visible on the
          // first `pnpm dev` rather than the first customer complaint.
          stock: {},
        },
      ],
    },
    {
      slug: 'sample-product-two',
      name: 'Sample product two',
      description:
        'A second product, in a nested category, so the category tree and the filter sidebar both have something to show.',
      brand: 'Your brand',
      category: 'sub-of-one',
      ageBand: '5-7',
      badge: null,
      featured: false,
      skills: ['replace this skill'],
      boxItems: ['Replace this line'],
      safety: {
        bisCertified: false,
        bisCertNo: null,
        bisCertExpiry: null,
        bpaFree: true,
        hasSmallParts: true,
      },
      variants: [
        {
          name: 'Standard',
          sku: 'SAMPLE-002-STD',
          priceMinor: 129_900,
          mrpMinor: 149_900,
          options: { size: 'standard' },
          weightGrams: 1_200,
          stock: { main: 8 },
        },
      ],
    },
  ],
});
