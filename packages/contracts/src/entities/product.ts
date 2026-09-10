import { z } from 'zod';

import { AgeBandSchema, ProductStatusSchema } from '../domain/product';
import { SkuSchema, SlugSchema } from '../primitives/identifiers';
import { CategoryIdSchema, ProductIdSchema, VariantIdSchema } from '../primitives/ids';
import { NullableInstantSchema } from '../primitives/instant';
import { MoneySchema } from '../primitives/money';

import { AuditTimestampsSchema, MediaItemSchema, SeoSchema } from './common';

/**
 * Toy safety declarations.
 *
 * These are legal claims, not marketing copy. `bisCertNo` and `bisCertExpiry` are
 * required together when `bisCertified` is true — a certification claim with no
 * certificate number is unverifiable, and an unverifiable safety claim on a
 * children's product is the kind of thing that should fail a build rather than
 * reach a product page.
 */
export const ProductSafetySchema = z
  .object({
    bisCertified: z.boolean(),
    bisCertNo: z.string().min(1).max(64).nullable(),
    bisCertExpiry: NullableInstantSchema,
    bpaFree: z.boolean(),
    /** Drives the choking-hazard notice, independent of the age band. */
    hasSmallParts: z.boolean(),
  })
  .refine((safety) => !safety.bisCertified || safety.bisCertNo !== null, {
    error: 'A BIS certification claim needs its certificate number.',
    path: ['bisCertNo'],
  })
  .refine((safety) => !safety.bisCertified || safety.bisCertExpiry !== null, {
    error: 'A BIS certification claim needs its expiry date.',
    path: ['bisCertExpiry'],
  });
export type ProductSafety = z.infer<typeof ProductSafetySchema>;

/**
 * A variant, denormalised onto its product.
 *
 * This exists so the product detail page can render its full variant selector
 * from a single document read. Without it, first paint needs a subcollection
 * query, which on a cold SSR render is a second round trip on the critical path
 * of the page that converts.
 *
 * `inStock` is a **boolean**, never a count. Exact stock levels are commercially
 * sensitive and rules keep `inventory` staff-only (`SECURITY.md` read matrix); a
 * count denormalised onto a publicly readable document would hand that straight
 * back. It is also the only honest granularity here, because the real number
 * changes between the read and the checkout.
 *
 * Owner: the variant write transaction. Never repaired lazily — a summary that
 * can drift is a summary that will show a price the customer is not charged.
 */
export const VariantSummarySchema = z.object({
  variantId: VariantIdSchema,
  name: z.string().min(1).max(120),
  sku: SkuSchema,
  priceMinor: MoneySchema,
  mrpMinor: MoneySchema,
  active: z.boolean(),
  inStock: z.boolean(),
});
export type VariantSummary = z.infer<typeof VariantSummarySchema>;

/**
 * `products/{productId}`.
 *
 * The public catalogue document. Everything a listing card or a detail page needs
 * for first paint is here, including the denormalised fields whose owners are
 * named in `DATA_MODEL.md`.
 */
export const ProductDocSchema = z
  .object({
    slug: SlugSchema,
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(5_000),
    /** Free text in v1.0. A brand collection is a roadmap item, not a v1.0 need. */
    brand: z.string().min(1).max(120),
    categoryId: CategoryIdSchema,
    /** Denormalised from `categories`. Owner: the category write Function. */
    categorySlug: SlugSchema,
    ageBand: AgeBandSchema,
    status: ProductStatusSchema,
    /** Display-only ribbon, e.g. "Bestseller". Null is the common case. */
    badge: z.string().min(1).max(40).nullable(),

    /** Denormalised minimum across live variants. Owner: the variant transaction. */
    priceFromMinor: MoneySchema,
    mrpFromMinor: MoneySchema,
    variantSummary: z.array(VariantSummarySchema),

    media: z.array(MediaItemSchema),
    /** "Skills it builds" tags. */
    skills: z.array(z.string().min(1).max(60)).max(12),
    /** "In the box" lines. */
    boxItems: z.array(z.string().min(1).max(120)).max(20),
    safety: ProductSafetySchema,

    /** Denormalised, one decimal place. Owner: the review publish transaction. */
    ratingAvg: z.number().min(0).max(5),
    ratingCount: z.int().nonnegative(),

    /**
     * Lowercased prefix tokens for v1.0 search (ADR-0002). Owner: the product
     * write Function. Bounded at 200 because Firestore caps a document at 40 000
     * index entries and an unbounded token array is the fastest way to find that
     * limit in production.
     */
    searchTokens: z.array(z.string().min(1).max(40)).max(200),
    seo: SeoSchema,

    ...AuditTimestampsSchema.shape,
    /** Null until the product first reaches `active`. Retained if it goes back to draft. */
    publishedAt: NullableInstantSchema,
  })
  .refine((product) => product.mrpFromMinor >= product.priceFromMinor, {
    error: 'MRP cannot be below the selling price.',
    path: ['mrpFromMinor'],
  })
  .refine(
    (product) =>
      product.status !== 'active' || product.variantSummary.some((variant) => variant.active),
    {
      // The API enforces this on write too; asserting it in the schema means a
      // document that somehow reached this state fails loudly on read rather than
      // rendering a product page with nothing to add to the cart.
      error: 'An active product needs at least one active variant.',
      path: ['variantSummary'],
    },
  )
  .refine((product) => product.ratingCount > 0 || product.ratingAvg === 0, {
    error: 'A product with no ratings has an average of 0, not a stored guess.',
    path: ['ratingAvg'],
  })
  .refine(
    (product) => {
      const orders = product.media.map((item) => item.order);
      return new Set(orders).size === orders.length;
    },
    {
      error: 'Media order values must be unique — the cover image cannot be ambiguous.',
      path: ['media'],
    },
  );
export type ProductDoc = z.infer<typeof ProductDocSchema>;

/**
 * `products/{productId}/variants/{variantId}`.
 *
 * A subcollection rather than an array on the product, because inventory
 * transactions target a variant individually and a transaction on an array
 * element means reading and rewriting the whole product document — which
 * serialises every concurrent checkout across all of a product's variants.
 */
export const VariantDocSchema = z
  .object({
    productId: ProductIdSchema,
    name: z.string().min(1).max(120),
    sku: SkuSchema,
    priceMinor: MoneySchema,
    mrpMinor: MoneySchema,
    /** Free-form selection axes, e.g. `{ ageBand: '6-8', finish: 'natural' }`. */
    options: z.record(z.string().min(1).max(40), z.string().min(1).max(80)),
    /**
     * `false` removes it from selection but keeps it resolvable. Order items
     * snapshot the variant, but an invoice reprint and a reorder flow both need
     * the original document to still exist.
     */
    active: z.boolean(),
    /** For shipping calculation, which is a roadmap item; captured now so it is not a backfill. */
    weightGrams: z.int().positive(),
    ...AuditTimestampsSchema.shape,
  })
  .refine((variant) => variant.mrpMinor >= variant.priceMinor, {
    error: 'MRP cannot be below the selling price.',
    path: ['mrpMinor'],
  });
export type VariantDoc = z.infer<typeof VariantDocSchema>;

/**
 * `categories/{categoryId}`.
 *
 * `productCount` **is** the facet count. Firestore cannot count matches in a
 * query, so the sidebar's numbers come from here or they do not exist
 * (`DATA_MODEL.md § documented query constraints`).
 */
export const CategoryDocSchema = z.object({
  name: z.string().min(1).max(80),
  slug: SlugSchema,
  /** One level of nesting. Null is a top-level category. */
  parentId: CategoryIdSchema.nullable(),
  /**
   * Whether the category is live. Distinct from the visibility flags: `showInNav` and
   * `showInFilters` decide *where* an active category appears, while `active` decides whether
   * it appears at all. A deactivated category is hidden from every storefront surface and is
   * not offered when categorising a product, without being deleted — deletion is refused while
   * products still reference it.
   */
  active: z.boolean(),
  showInFilters: z.boolean(),
  showInNav: z.boolean(),
  /** Denormalised facet count of `active` products. Owner: the product write Function. */
  productCount: z.int().nonnegative(),
  sortOrder: z.int().nonnegative(),
  ...AuditTimestampsSchema.shape,
});
export type CategoryDoc = z.infer<typeof CategoryDocSchema>;

/**
 * The single product status a public query filters on.
 *
 * Exported as a value so the storefront's `where('status', '==', …)` and the
 * security rule that permits the read cannot disagree about which string that is.
 */
export const PUBLIC_PRODUCT_STATUS = ProductStatusSchema.parse('active');
