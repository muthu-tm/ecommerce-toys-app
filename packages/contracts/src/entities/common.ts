import { z } from 'zod';

import { InstantSchema } from '../primitives/instant';

/**
 * Shapes that appear in more than one document.
 *
 * Defined once so a change to, say, what a media entry carries cannot land on
 * products and miss the variant summary that mirrors it.
 *
 * A note on strictness that applies to every document schema in this directory:
 * they **strip** unknown keys rather than rejecting them. That is a deliberate
 * choice about deploys, not laziness. During a rolling deploy the new version
 * writes a field the old version has never heard of, and the old version keeps
 * reading those documents; a strict schema would turn that overlap into a
 * storefront outage. Stripping means the old version ignores what it does not
 * understand. The cost is that a typo'd field name is dropped silently on write,
 * which is why writes go through builders that construct the object from a typed
 * source rather than from loose input.
 */

/** Timestamps every mutable document carries. */
export const AuditTimestampsSchema = z.object({
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});

/**
 * One image or video attached to a product.
 *
 * `path` is a Storage object path, never a download URL. URLs embed a token that
 * rotates when the object is replaced, so a stored URL is a link that breaks on
 * the next upload; the path is stable and the URL is derived at render time.
 *
 * `width` and `height` are required because `next/image` needs intrinsic
 * dimensions to reserve space, and a missing pair is a layout shift on the
 * highest-traffic element of the page.
 */
export const MediaItemSchema = z.object({
  path: z.string().min(1).max(1_024),
  alt: z
    .string()
    .min(1, { error: 'Every image needs alt text. Decorative product images do not exist.' })
    .max(300),
  width: z.int().positive(),
  height: z.int().positive(),
  /** Low-resolution placeholder. Null until the resize Function has produced one. */
  blurhash: z.string().min(1).max(200).nullable(),
  /** Display order. `0` is the cover image. */
  order: z.int().nonnegative(),
});
export type MediaItem = z.infer<typeof MediaItemSchema>;

/**
 * Search and discovery metadata.
 *
 * `index` is the robots directive. It defaults nowhere — a product that is
 * ambiguous about whether it should be indexed ends up indexed by accident, and
 * de-indexing after the fact is slow.
 */
export const SeoSchema = z.object({
  /** Overrides the derived `<title>`. Null means "derive it from the name". */
  title: z.string().min(1).max(70).nullable(),
  description: z.string().min(1).max(200).nullable(),
  index: z.boolean(),
});
export type Seo = z.infer<typeof SeoSchema>;

/**
 * A postal address as captured from a customer.
 *
 * **PII.** Every field here is personal data; see the PII map in `SECURITY.md`.
 * `phone` is deliberately a plain string rather than `E164PhoneSchema`: a
 * delivery contact number is not a login credential, it is whatever the customer
 * wants the courier to call, and rejecting a landline or an extension would block
 * a legitimate order.
 */
export const PostalAddressSchema = z.object({
  recipientName: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullable(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  pincode: z.string().regex(/^[1-9]\d{5}$/, { error: 'Enter a valid 6-digit PIN code.' }),
  phone: z.string().min(4).max(30),
});
export type PostalAddress = z.infer<typeof PostalAddressSchema>;
