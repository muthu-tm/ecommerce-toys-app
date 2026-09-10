import { z } from 'zod';

import { AgeBandSchema, ProductStatusSchema } from '../domain/product';
import { SkuSchema, SlugSchema } from '../primitives/identifiers';
import { WarehouseIdSchema } from '../primitives/ids';
import { MoneySchema } from '../primitives/money';

/**
 * Toy-safety declarations as they cross the wire.
 *
 * A wire-specific mirror of the stored `ProductSafetySchema`, differing in one field: the
 * BIS certificate expiry is an ISO **date string** here, not a `Date`. The stored schema
 * uses `Date` (an `Instant`), which JSON Schema cannot represent — so the HTTP contract
 * carries the string a form actually submits, and the handler parses it to a `Date` before
 * building the document. The same cross-field rules apply: a certification claim needs both
 * a number and an expiry.
 */
const SafetyInputSchema = z
  .object({
    bisCertified: z.boolean(),
    bisCertNo: z.string().min(1).max(64).nullable(),
    bisCertExpiry: z.iso.date().nullable(),
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

/**
 * Request and response contracts for the backoffice catalogue endpoints.
 *
 * These describe what the admin UI sends, not what is stored. The stored `ProductDoc`
 * carries denormalised fields the API computes — `variantSummary`, `priceFromMinor`, the
 * search tokens, the audit timestamps — so a create or edit request omits all of them: the
 * handler assembles the document from validated input plus `@romp/core` helpers. Prices
 * cross the wire as `Money` (integer paise), the same unit they are stored and compared in,
 * so an admin form is responsible for converting rupees before it posts.
 */

/** The SEO fields an admin edits: title/description overrides and the index directive. */
const SeoInputSchema = z.object({
  title: z.string().min(1).max(70).nullable(),
  description: z.string().min(1).max(200).nullable(),
  index: z.boolean(),
});

/**
 * Create a product.
 *
 * The slug is optional: omitted, the handler derives it from the name (`deriveSlug`); given,
 * it is validated and used as-is, so an admin can override the default. A new product is
 * always created as a `draft` with no variants — publication and variants are separate
 * steps, each with a rule this create should not have to know — so neither `status` nor a
 * variant list appears here.
 */
export const CreateProductRequestSchema = z.object({
  name: z.string().min(1).max(200),
  slug: SlugSchema.optional(),
  description: z.string().min(1).max(5_000),
  brand: z.string().min(1).max(120),
  categoryId: z.string().min(1).max(200),
  categorySlug: SlugSchema,
  ageBand: AgeBandSchema,
  badge: z.string().min(1).max(40).nullable(),
  skills: z.array(z.string().min(1).max(60)).max(12),
  boxItems: z.array(z.string().min(1).max(120)).max(20),
  safety: SafetyInputSchema,
  seo: SeoInputSchema,
});
export type CreateProductRequest = z.infer<typeof CreateProductRequestSchema>;

export const CreateProductResponseSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
});
export type CreateProductResponse = z.infer<typeof CreateProductResponseSchema>;

/**
 * Edit a product's content.
 *
 * The same content fields as create, minus the slug — a product's slug is its URL identity
 * and changing it breaks links and search results, so a rename is a deliberate separate
 * action, not a side effect of an edit. Media is edited through its own endpoints (upload
 * and finalize), so it is absent here too.
 */
export const UpdateProductRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(5_000),
  brand: z.string().min(1).max(120),
  categoryId: z.string().min(1).max(200),
  categorySlug: SlugSchema,
  ageBand: AgeBandSchema,
  badge: z.string().min(1).max(40).nullable(),
  skills: z.array(z.string().min(1).max(60)).max(12),
  boxItems: z.array(z.string().min(1).max(120)).max(20),
  safety: SafetyInputSchema,
  seo: SeoInputSchema,
});
export type UpdateProductRequest = z.infer<typeof UpdateProductRequestSchema>;

/**
 * Change a product's publication status.
 *
 * Only the target status crosses the wire; the legal transitions are the server's, enforced
 * by the product status machine. `archived` here is the "unlist" action; `draft` is
 * unpublish; `active` is publish and requires an active variant.
 */
export const ProductStatusChangeRequestSchema = z.object({
  status: ProductStatusSchema,
});
export type ProductStatusChangeRequest = z.infer<typeof ProductStatusChangeRequestSchema>;

/** The variant fields an admin sends on create or edit. Prices are integer paise. */
const VariantBodySchema = z
  .object({
    name: z.string().min(1).max(120),
    sku: SkuSchema,
    priceMinor: MoneySchema,
    mrpMinor: MoneySchema,
    options: z.record(z.string().min(1).max(40), z.string().min(1).max(80)),
    active: z.boolean(),
    weightGrams: z.int().positive(),
  })
  .refine((variant) => variant.mrpMinor >= variant.priceMinor, {
    error: 'MRP cannot be below the selling price.',
    path: ['mrpMinor'],
  });

export const CreateVariantRequestSchema = VariantBodySchema;
export type CreateVariantRequest = z.infer<typeof CreateVariantRequestSchema>;

export const CreateVariantResponseSchema = z.object({ id: z.string() });
export type CreateVariantResponse = z.infer<typeof CreateVariantResponseSchema>;

export const UpdateVariantRequestSchema = VariantBodySchema;
export type UpdateVariantRequest = z.infer<typeof UpdateVariantRequestSchema>;

/**
 * Register a media upload slot.
 *
 * The admin does not upload through the API — the client SDK writes straight to Storage,
 * where the rules gate it by the operator's token, size and declared type. This endpoint
 * allocates the object path the client must upload to and records a pending media entry, so
 * the file has a home on the product before it exists in the bucket. `alt` is required
 * because every product image needs alt text, and `contentType` chooses the extension of
 * the allocated path. The declared type is still only a claim — the finalize Function
 * re-derives it — so this validates it against the allowed set but does not trust it.
 */
export const RegisterMediaRequestSchema = z.object({
  alt: z.string().min(1).max(300),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
});
export type RegisterMediaRequest = z.infer<typeof RegisterMediaRequestSchema>;

export const RegisterMediaResponseSchema = z.object({
  /** The Storage object path the client must upload to. */
  path: z.string(),
});
export type RegisterMediaResponse = z.infer<typeof RegisterMediaResponseSchema>;

/**
 * Adjust a variant's stock at one warehouse.
 *
 * A signed `delta` — positive receives stock, negative removes it — applied to one warehouse,
 * with a reason the operator may select. Only `adjustment` and `reconciliation` cross this
 * wire: the rest of the ledger reasons (`order_committed`, `refund_restock`, and so on) are
 * written by the system on the flows that own them, never chosen by hand. A `note` is
 * required for a plain adjustment, where the reason enum alone does not explain what happened
 * — a physical recount, a damaged-goods write-off — and optional for a reconciliation, which
 * the runbook already documents.
 *
 * The warehouse is `stock`-map addressing, not free text: it must be a warehouse code, so the
 * delta lands on a real location. `productId` is not in the body — it is the product in the
 * route path, which the variant belongs to.
 */
export const InventoryAdjustRequestSchema = z
  .object({
    warehouseId: WarehouseIdSchema,
    /** Signed whole units. Zero is refused — an adjustment that moves nothing is a mistake. */
    delta: z
      .int({ error: 'A stock movement is a whole number of units.' })
      .refine((value) => value !== 0, { error: 'A stock movement cannot be zero.' }),
    reason: z.enum(['adjustment', 'reconciliation']),
    note: z.string().min(1).max(500).nullable(),
  })
  .refine((body) => body.reason !== 'adjustment' || body.note !== null, {
    error: 'A manual adjustment needs a note explaining it.',
    path: ['note'],
  });
export type InventoryAdjustRequest = z.infer<typeof InventoryAdjustRequestSchema>;

/** The stock balance after an adjustment. Counts are staff-only, and this is a staff route. */
export const InventoryResponseSchema = z.object({
  variantId: z.string(),
  onHandTotal: z.int().nonnegative(),
  reserved: z.int().nonnegative(),
  /** On-hand units per warehouse code. */
  stock: z.record(WarehouseIdSchema, z.int().nonnegative()),
});
export type InventoryResponse = z.infer<typeof InventoryResponseSchema>;
