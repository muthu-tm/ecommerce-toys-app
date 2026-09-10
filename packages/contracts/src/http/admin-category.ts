import { z } from 'zod';

import { SlugSchema } from '../primitives/identifiers';

/**
 * The backoffice category wire contracts.
 *
 * A category is navigation, not commerce, so these are about the tree rather than money: a name,
 * an optional parent (one level deep — the server refuses a grandchild), the two visibility flags
 * that decide where an active category appears, an `active` flag that decides whether it appears
 * at all, and a sort order. The slug is set once, on create — it is the URL identity and the
 * document ID, so it never appears on the edit contract; a rename changes the name, not the link.
 * `productCount` is never on any request: it is a denormalised facet count the product-write
 * Function owns, so a client that tried to set it would be writing a number it cannot keep true.
 */

const nameSchema = z.string().min(1).max(80);
const sortOrderSchema = z.int().min(0).max(1_000);

/**
 * Create a category.
 *
 * `slug` is optional: when absent the server derives it from the name (the same `deriveSlug`
 * products use), which is what a "just give it a name" create wants; when present it is validated
 * as a slug so an operator can pin a URL. `parentId` is the parent's slug or null for a top-level
 * category. Uniqueness is enforced server-side by the write, not here — this cannot know what
 * slugs already exist.
 */
export const CreateCategoryRequestSchema = z.object({
  name: nameSchema,
  slug: SlugSchema.optional(),
  parentId: SlugSchema.nullable(),
  active: z.boolean(),
  showInNav: z.boolean(),
  showInFilters: z.boolean(),
  sortOrder: sortOrderSchema,
});
export type CreateCategoryRequest = z.infer<typeof CreateCategoryRequestSchema>;

export const CreateCategoryResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
});
export type CreateCategoryResponse = z.infer<typeof CreateCategoryResponseSchema>;

/**
 * Edit a category's mutable fields.
 *
 * Everything a create takes except the slug, which is immutable. `parentId` may change here —
 * the server re-validates that the new parent keeps the tree one level deep and does not orphan
 * this category's own children.
 */
export const UpdateCategoryRequestSchema = z.object({
  name: nameSchema,
  parentId: SlugSchema.nullable(),
  active: z.boolean(),
  showInNav: z.boolean(),
  showInFilters: z.boolean(),
  sortOrder: sortOrderSchema,
});
export type UpdateCategoryRequest = z.infer<typeof UpdateCategoryRequestSchema>;

/**
 * Reorder categories.
 *
 * A drag-reorder submits the whole new ordering as a list of slug → sortOrder pairs, applied in
 * one batch. Slugs must be unique in the list — the same category cannot be told to sit in two
 * places at once.
 */
export const ReorderCategoriesRequestSchema = z.object({
  orders: z
    .array(z.object({ slug: SlugSchema, sortOrder: sortOrderSchema }))
    .min(1)
    .max(200)
    .refine((orders) => new Set(orders.map((o) => o.slug)).size === orders.length, {
      error: 'Each category may appear only once in a reorder.',
    }),
});
export type ReorderCategoriesRequest = z.infer<typeof ReorderCategoriesRequestSchema>;
