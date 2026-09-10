import { z } from 'zod';

import { AgeBandSchema } from '../domain/product';
import { SkuSchema, SlugSchema } from '../primitives/identifiers';
import { ProductIdSchema, VariantIdSchema } from '../primitives/ids';
import { MoneySchema } from '../primitives/money';
import { CursorSchema, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../primitives/pagination';

/**
 * Catalogue discovery, as an **engine-neutral** contract.
 *
 * `ProductQuery` describes *intent* — a category, an age band, a price band, a sort
 * order — not a Firestore query builder. That is the commitment that makes
 * ADR-0002's `SearchPort` real rather than decorative: if a page reached around the
 * port to assemble a Firestore query, swapping in Typesense would stop being
 * contained and the port would have failed.
 *
 * These schemas live in `@romp/contracts` rather than beside the adapter because a
 * query is parsed from URL search parameters at a boundary, and everything parsed at
 * a boundary is validated by a schema here.
 */

/**
 * The most values Firestore accepts in an `in` or `array-contains-any` filter.
 *
 * A hard platform limit, not a policy choice, which is why it is exported: the API
 * layer surfaces it in a validation message, and the adapter raises
 * `TooManyFilterValuesError` rather than quietly returning results for the first ten.
 * A silent truncation is a wrong-results bug nobody reports, because nobody can see it.
 */
export const MAX_FILTER_VALUES = 10;

/**
 * Sort orders the catalogue offers.
 *
 * A closed enum rather than a `field:direction` string, for two reasons. Every option
 * here needs a composite index, so an open-ended sort parameter is an invitation to
 * request a query that returns a Firestore error at runtime. And each one is a
 * product decision — `relevance` is deliberately absent until there is an engine that
 * can rank.
 */
export const ProductSortSchema = z.enum([
  /** Newest first, by `publishedAt`. The default: a catalogue's front page is what is new. */
  'newest',
  'price_asc',
  'price_desc',
  'rating_desc',
]);
export type ProductSort = z.infer<typeof ProductSortSchema>;

export const DEFAULT_PRODUCT_SORT: ProductSort = 'newest';

/**
 * A price band, in paise.
 *
 * Both ends are optional, so "under ₹500" and "over ₹2000" are expressible without a
 * sentinel value standing in for infinity.
 */
export const PriceBandSchema = z
  .object({
    minMinor: MoneySchema.optional(),
    maxMinor: MoneySchema.optional(),
  })
  .refine(
    (band) =>
      band.minMinor === undefined || band.maxMinor === undefined || band.minMinor <= band.maxMinor,
    {
      // An inverted band returns nothing, which looks like an empty catalogue rather
      // than a bad filter. Rejecting it means the customer sees a fixable message.
      error: 'The minimum price cannot exceed the maximum.',
      path: ['minMinor'],
    },
  );
export type PriceBand = z.infer<typeof PriceBandSchema>;

/**
 * A catalogue query.
 *
 * Every field is optional except the page size, so an empty object is the valid
 * "everything, newest first" query the home page and the top-level listing both use.
 */
export const ProductQuerySchema = z
  .object({
    /** Category slugs. More than one is an `in` filter, capped at ten values. */
    categorySlugs: z.array(SlugSchema).max(MAX_FILTER_VALUES).optional(),
    /** Age band values, from the store's configured taxonomy. */
    ageBands: z.array(AgeBandSchema).max(MAX_FILTER_VALUES).optional(),
    brands: z.array(z.string().min(1).max(120)).max(MAX_FILTER_VALUES).optional(),
    price: PriceBandSchema.optional(),
    /**
     * Free text. Reduced to a single prefix token by the adapter, which is the
     * ceiling of what Firestore can do (ADR-0002). A customer typing `helicoptor`
     * finds nothing in v1.0, and that is the documented weak point.
     */
    text: z.string().max(200).optional(),
    /** Hide products with nothing sellable. Served from the denormalised variant boolean. */
    inStockOnly: z.boolean().optional(),
    sort: ProductSortSchema.default(DEFAULT_PRODUCT_SORT),
    limit: z.int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    cursor: CursorSchema.optional(),
  })
  .refine(
    (query) => {
      // Firestore permits exactly one range field per query, and `priceFromMinor` is
      // it. Sorting by rating while filtering on price needs a second, so the
      // combination is refused here — before a query reaches the adapter and returns
      // a Firestore error with no field to attach it to.
      const hasPriceRange =
        query.price !== undefined &&
        (query.price.minMinor !== undefined || query.price.maxMinor !== undefined);
      return !hasPriceRange || query.sort !== 'rating_desc';
    },
    {
      error:
        'Filtering by price and sorting by rating cannot be combined. Sort by price, or drop the price filter.',
      path: ['sort'],
    },
  );

export type ProductQuery = z.input<typeof ProductQuerySchema>;
export type ResolvedProductQuery = z.output<typeof ProductQuerySchema>;

/**
 * What a listing card needs, and nothing more.
 *
 * A projection rather than the whole `ProductDoc`: a 24-item listing page carrying
 * full descriptions, media arrays and search tokens is an order of magnitude more
 * bytes over the wire for fields the card never renders. The projection is also what
 * lets the Typesense adapter return a stored document rather than reading Firestore.
 */
export const ProductSummarySchema = z.object({
  id: ProductIdSchema,
  slug: SlugSchema,
  name: z.string(),
  brand: z.string(),
  categorySlug: SlugSchema,
  ageBand: AgeBandSchema,
  badge: z.string().nullable(),
  priceFromMinor: MoneySchema,
  mrpFromMinor: MoneySchema,
  ratingAvg: z.number(),
  ratingCount: z.int(),
  /** Cover image only — `order: 0` — with the alt text and dimensions the card needs. */
  cover: z
    .object({
      path: z.string(),
      alt: z.string(),
      width: z.int(),
      height: z.int(),
      blurhash: z.string().nullable(),
    })
    .nullable(),
  /** True when any active variant has stock. Never a count. */
  inStock: z.boolean(),
  variantCount: z.int().nonnegative(),
});
export type ProductSummary = z.infer<typeof ProductSummarySchema>;

/**
 * Facet counts.
 *
 * v1.0 answers the category dimension only, from `categories.productCount`, because
 * Firestore cannot count matches in a query. The signature is designed against the
 * **target** capability so that no caller changes when Typesense fills in the rest:
 * a dimension that cannot be counted yet returns an empty map, not an error, and a UI
 * that reads it renders no counts rather than breaking.
 */
export const FacetCountsSchema = z.object({
  categories: z.record(SlugSchema, z.int().nonnegative()),
  ageBands: z.record(z.string(), z.int().nonnegative()),
  brands: z.record(z.string(), z.int().nonnegative()),
  /**
   * Which dimensions the counts above are actually complete for. A UI must not render
   * "Wooden toys (0)" when the truth is "we did not count".
   */
  countedDimensions: z.array(z.enum(['categories', 'ageBands', 'brands'])),
});
export type FacetCounts = z.infer<typeof FacetCountsSchema>;

/** A search-box suggestion. */
export const SuggestionSchema = z.object({
  slug: SlugSchema,
  name: z.string(),
  /** Shown beside the name so two similarly named products are distinguishable. */
  brand: z.string(),
  priceFromMinor: MoneySchema,
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

/**
 * A variant as the product detail page needs it.
 *
 * Distinct from `VariantDoc` because the PDP needs availability, and availability is
 * derived from `inventory` — which is staff-only. The derivation happens server-side
 * and only the boolean crosses the boundary.
 */
export const VariantOptionSchema = z.object({
  id: VariantIdSchema,
  name: z.string(),
  sku: SkuSchema,
  priceMinor: MoneySchema,
  mrpMinor: MoneySchema,
  options: z.record(z.string(), z.string()),
  active: z.boolean(),
  inStock: z.boolean(),
});
export type VariantOption = z.infer<typeof VariantOptionSchema>;
