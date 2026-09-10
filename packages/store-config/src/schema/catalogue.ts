import { z } from 'zod';

import { MoneySchema } from '@romp/contracts';

/**
 * The seed catalogue.
 *
 * A store's starting products, in a file beside its config:
 * `stores/<id>/seed.catalogue.ts`. Separate from `store.config.ts` on purpose —
 * the config is the store's *identity* and is read at build time by the token
 * generator and by `next.config`, while this is *data* read once by `pnpm seed`.
 * Merging them would put a hundred products in the module that every page imports.
 *
 * Everything here is cross-checked against the store config by the loader:
 * category slugs, age-band values and warehouse codes must all exist. A product
 * pointing at a category the store does not have is caught before a single
 * document is written, rather than producing a catalogue with an unreachable
 * product in it.
 *
 * Money is in **paise**, like everywhere else (ADR-0004). Writing `129900` rather
 * than `1299.00` is less friendly to type and completely unambiguous, and this file
 * is authored once per store by someone who has read the docs.
 */

/**
 * A product image in the seed.
 *
 * `file` is a path relative to `stores/<id>/assets/catalogue/`, and the loader
 * checks it exists. Uploading it to Cloud Storage is **not** the seed's job — that
 * is the admin media pipeline in Task 12, which also re-derives the content type
 * from magic bytes and generates the responsive variants. A seed that uploaded raw
 * files would bypass both.
 *
 * Which means: a freshly seeded store renders product cards with the storefront's
 * placeholder until real photography is uploaded through admin. That is the honest
 * state of a new store, and it is visibly different from a broken image.
 */
export const CatalogueMediaSchema = z.object({
  file: z.string().min(1).max(200),
  alt: z.string().min(1).max(300),
  width: z.int().positive(),
  height: z.int().positive(),
});
export type CatalogueMedia = z.infer<typeof CatalogueMediaSchema>;

export const CatalogueSafetySchema = z
  .object({
    bisCertified: z.boolean(),
    bisCertNo: z.string().min(1).max(64).nullable(),
    /** ISO date, e.g. `2028-01-01`. A date, not a timestamp — certificates expire on days. */
    bisCertExpiry: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, { error: 'A certificate expiry is an ISO date, yyyy-mm-dd.' })
      .nullable(),
    bpaFree: z.boolean(),
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
export type CatalogueSafety = z.infer<typeof CatalogueSafetySchema>;

/**
 * A seeded variant.
 *
 * `stock` keys are warehouse codes. A code the store has not configured is a
 * loader error, because the alternative — writing stock against a warehouse that
 * does not exist — produces an `inventory` document whose `onHandTotal` no
 * allocation can ever draw down.
 */
export const CatalogueVariantSchema = z
  .object({
    name: z.string().min(1).max(120),
    /** Unique across the whole catalogue. Becomes the variant document ID. */
    sku: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9._-]*$/u, {
        error: 'A seed SKU is upper-case alphanumeric with dots, dashes or underscores.',
      })
      .max(64),
    priceMinor: MoneySchema,
    mrpMinor: MoneySchema,
    options: z.record(z.string().min(1).max(40), z.string().min(1).max(80)),
    weightGrams: z.int().positive(),
    /** Opening stock per warehouse code. An empty map seeds a genuinely out-of-stock variant. */
    stock: z.record(z.string().min(1), z.int().nonnegative()),
    /** Defaults to true; set false to seed a variant that exists but is not sellable. */
    active: z.boolean().default(true),
  })
  .refine((variant) => variant.mrpMinor >= variant.priceMinor, {
    error: 'MRP cannot be below the selling price.',
    path: ['mrpMinor'],
  });
export type CatalogueVariant = z.infer<typeof CatalogueVariantSchema>;

export const CatalogueProductSchema = z
  .object({
    /** Becomes the URL identity and the product document ID. Unique. */
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, { error: 'Must be a lowercase hyphenated slug.' })
      .max(120),
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(5_000),
    brand: z.string().min(1).max(120),
    /** Slug of a category declared in `content.categories`. */
    category: z.string().min(1),
    /** Value of an age band declared in `content.ageBands`. */
    ageBand: z.string().min(1),
    badge: z.string().min(1).max(40).nullable().default(null),
    /** Seeded as `draft` if you want it invisible until an editor reviews it. */
    status: z.enum(['active', 'draft']).default('active'),
    skills: z.array(z.string().min(1).max(60)).max(12).default([]),
    boxItems: z.array(z.string().min(1).max(120)).max(20).default([]),
    safety: CatalogueSafetySchema,
    media: z.array(CatalogueMediaSchema).max(10).default([]),
    variants: z
      .array(CatalogueVariantSchema)
      .min(1, { error: 'A product needs at least one variant — a variant is what is bought.' }),
    /** Featured products fill the home page rail. */
    featured: z.boolean().default(false),
  })
  .refine(
    (product) => {
      const skus = product.variants.map((variant) => variant.sku);
      return new Set(skus).size === skus.length;
    },
    { error: 'Variant SKUs must be unique within a product.', path: ['variants'] },
  )
  .refine((product) => product.status !== 'active' || product.variants.some((v) => v.active), {
    error: 'An active product needs at least one active variant.',
    path: ['variants'],
  });
export type CatalogueProduct = z.infer<typeof CatalogueProductSchema>;

export const CatalogueSeedSchema = z
  .object({
    products: z.array(CatalogueProductSchema).min(1, {
      error: 'A seed catalogue with no products leaves nothing to browse.',
    }),
  })
  .refine(
    (catalogue) => {
      const slugs = catalogue.products.map((product) => product.slug);
      return new Set(slugs).size === slugs.length;
    },
    {
      error: 'Product slugs must be unique — they are URL identities and document IDs.',
      path: ['products'],
    },
  )
  .refine(
    (catalogue) => {
      // SKU uniqueness is store-wide, not per product: a SKU is what an operator
      // reads off a physical box, and two products sharing one makes a picking
      // error undetectable.
      const skus = catalogue.products.flatMap((product) =>
        product.variants.map((variant) => variant.sku),
      );
      return new Set(skus).size === skus.length;
    },
    { error: 'SKUs must be unique across the whole catalogue.', path: ['products'] },
  );

export type CatalogueSeed = z.infer<typeof CatalogueSeedSchema>;
/** The shape an author writes, before defaults are applied. */
export type CatalogueSeedInput = z.input<typeof CatalogueSeedSchema>;

/**
 * Declares a seed catalogue.
 *
 * Like `defineStoreConfig`, this deliberately **does not validate**. It exists for
 * editor completion while authoring; validation is `loadCatalogueSeed`'s job, which
 * also cross-checks the references this schema cannot see.
 */
export function defineCatalogueSeed(catalogue: CatalogueSeedInput): CatalogueSeedInput {
  return catalogue;
}
