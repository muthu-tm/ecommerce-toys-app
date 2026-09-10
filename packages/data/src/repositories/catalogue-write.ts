import type { MediaItem, ProductDoc, ProductStatus, VariantDoc } from '@romp/contracts';
import { normaliseMediaOrder, resolveStatusTransition, summariseVariants } from '@romp/core';

import type { Caller, StoreContext } from '../context';
import { requireStaff } from '../context';
import type { WithId } from '../converter';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

/**
 * The catalogue write paths — the first mutations `@romp/data` owns.
 *
 * Everything here is staff-only and goes through a validating converter, so an invalid
 * product never reaches Firestore and a customer never reads one. The hard part is not the
 * writes themselves but keeping the product document's **denormalised** fields —
 * `variantSummary`, `priceFromMinor`, `mrpFromMinor` — consistent with the variant
 * subcollection they summarise. A variant write therefore re-reads the product's variants
 * and rewrites the summary in the **same transaction**, because a summary that can drift is
 * a summary that will one day show a price the customer is not charged.
 *
 * The pure decisions — how to summarise variants, how to renumber media, whether a status
 * transition is legal — live in `@romp/core` and are unit-tested there. This module is the
 * Firestore plumbing around them.
 */

/** The staff descriptor used across these writes for the 404-not-403 disclosure rule. */
const PRODUCT_RESOURCE = { resource: 'product' } as const;

/**
 * Creates a product document.
 *
 * Takes a fully-assembled `ProductDoc` — the API route builds it from validated input using
 * the `@romp/core` helpers (slug, search parts, empty summary) — so this stays a thin,
 * converter-validated write. A new product has no variants yet, so its summary is empty and
 * its "from" prices are zero until the first variant is added; the status is `draft`, which
 * the schema permits with an empty summary (only `active` requires an active variant).
 *
 * Returns the generated document ID, which the admin UI needs to navigate to the edit page
 * and which subsequent variant and media writes address.
 */
export async function createProduct(
  ctx: StoreContext,
  caller: Caller,
  product: ProductDoc,
): Promise<{ readonly id: string }> {
  requireStaff(caller, PRODUCT_RESOURCE);

  const ref = await ctx.db
    .collection(COLLECTIONS.products)
    .withConverter(converters.products)
    .add(product);

  return { id: ref.id };
}

/** The product fields an admin may edit directly, without touching variants or status. */
export interface ProductEditablePatch {
  readonly name: string;
  readonly description: string;
  readonly brand: string;
  readonly categoryId: ProductDoc['categoryId'];
  readonly categorySlug: ProductDoc['categorySlug'];
  readonly ageBand: ProductDoc['ageBand'];
  readonly badge: ProductDoc['badge'];
  readonly skills: readonly string[];
  readonly boxItems: readonly string[];
  readonly safety: ProductDoc['safety'];
  readonly media: readonly MediaItem[];
  readonly searchTokens: readonly string[];
  readonly seo: ProductDoc['seo'];
}

/**
 * Updates a product's editable content.
 *
 * A transaction because it must read the current document (to fail cleanly if the product
 * is gone, and to preserve the fields it does not touch) and write it back atomically. The
 * media order is normalised here so the `unique order` invariant holds regardless of what a
 * drag-reorder UI submitted, and `searchTokens` are supplied by the caller (derived in
 * `@romp/core` from the new name/brand/category) so an edited name is findable.
 *
 * Does not change `status`, variants or the denormalised prices — those have their own
 * paths, because each has a rule this edit should not have to know.
 */
export async function updateProduct(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
  patch: ProductEditablePatch,
): Promise<void> {
  requireStaff(caller, PRODUCT_RESOURCE);

  const ref = ctx.db.doc(paths.product(productId)).withConverter(converters.products);

  await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (current === undefined) {
      throw new ProductNotFoundError(productId);
    }

    const next: ProductDoc = {
      ...current,
      name: patch.name,
      description: patch.description,
      brand: patch.brand,
      categoryId: patch.categoryId,
      categorySlug: patch.categorySlug,
      ageBand: patch.ageBand,
      badge: patch.badge,
      skills: [...patch.skills],
      boxItems: [...patch.boxItems],
      safety: patch.safety,
      media: [...normaliseMediaOrder([...patch.media])],
      searchTokens: [...patch.searchTokens],
      seo: patch.seo,
      updatedAt: ctx.clock.now(),
    };

    tx.set(ref, next);
  });
}

/** Raised when a write targets a product ID that does not exist. */
export class ProductNotFoundError extends Error {
  readonly productId: string;
  constructor(productId: string) {
    super(`Product "${productId}" does not exist.`);
    this.name = 'ProductNotFoundError';
    this.productId = productId;
  }
}

/** Raised when a status change is not legal for the product's current state. */
export class IllegalProductTransitionError extends Error {
  readonly from: ProductStatus;
  readonly to: ProductStatus;
  readonly allowed: readonly ProductStatus[];
  constructor(from: ProductStatus, to: ProductStatus, allowed: readonly ProductStatus[]) {
    super(`Cannot move a product from "${from}" to "${to}".`);
    this.name = 'IllegalProductTransitionError';
    this.from = from;
    this.to = to;
    this.allowed = allowed;
  }
}

/** Raised when publishing a product that has no active variant to sell. */
export class NoActiveVariantError extends Error {
  readonly productId: string;
  constructor(productId: string) {
    super(`Product "${productId}" cannot be active with no active variant.`);
    this.name = 'NoActiveVariantError';
    this.productId = productId;
  }
}

/**
 * Changes a product's publication status (publish, unpublish, archive).
 *
 * The transition legality lives in `@romp/core`'s `resolveStatusTransition` (which also
 * decides `publishedAt`); this adds the one rule that needs the variant summary — a product
 * cannot go `active` with no active variant, the invariant the schema also refines. A
 * transaction so the read of the current status and the write of the new one cannot race a
 * concurrent variant change. `seo.index` is set to match publication: an unpublished product
 * must not stay indexed.
 */
export async function setProductStatus(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
  to: ProductStatus,
): Promise<void> {
  requireStaff(caller, PRODUCT_RESOURCE);

  const ref = ctx.db.doc(paths.product(productId)).withConverter(converters.products);

  await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (current === undefined) {
      throw new ProductNotFoundError(productId);
    }

    const resolved = resolveStatusTransition(
      current.status,
      to,
      current.publishedAt,
      ctx.clock.now(),
    );
    if (!resolved.ok) {
      throw new IllegalProductTransitionError(current.status, to, resolved.allowed);
    }

    if (to === 'active' && !current.variantSummary.some((variant) => variant.active)) {
      throw new NoActiveVariantError(productId);
    }

    tx.set(ref, {
      ...current,
      status: resolved.transition.status,
      publishedAt: resolved.transition.publishedAt,
      // Indexing follows publication: a draft or archived product is not crawlable.
      seo: { ...current.seo, index: to === 'active' },
      updatedAt: ctx.clock.now(),
    });
  });
}

/** A variant document with its ID, as read inside a transaction. */
interface VariantWithId {
  readonly id: string;
  readonly data: VariantDoc;
}

/**
 * Recomputes a product's denormalised summary from a variant set.
 *
 * Pure over its inputs: the caller reads the product and its variants (Firestore requires
 * all transaction reads before any writes, so the read cannot live inside a helper that also
 * writes), applies the pending create or update to the variant list in memory, and passes
 * the result here. Returns the product document to write back. `inStock` is preserved from
 * the product's prior summary — availability is owned by the inventory transaction (Task 13),
 * not a catalogue edit — defaulting to false for a variant with no prior entry.
 *
 * Sorting by price makes the summary order match the detail page's selector, and keeps the
 * output deterministic so an unchanged variant set does not rewrite the product.
 */
function productWithRefreshedSummary(
  product: ProductDoc,
  variants: readonly VariantWithId[],
  now: Date,
): ProductDoc {
  const priorInStock = new Map<string, boolean>(
    product.variantSummary.map((entry) => [entry.variantId, entry.inStock]),
  );

  const ordered = [...variants].sort((left, right) => left.data.priceMinor - right.data.priceMinor);

  const pricing = summariseVariants(
    ordered.map(({ id, data }) => ({
      variantId: id,
      name: data.name,
      sku: data.sku,
      priceMinor: data.priceMinor,
      mrpMinor: data.mrpMinor,
      active: data.active,
      inStock: priorInStock.get(id) ?? false,
    })),
  );

  return {
    ...product,
    variantSummary: [...pricing.variantSummary],
    priceFromMinor: pricing.priceFromMinor,
    mrpFromMinor: pricing.mrpFromMinor,
    updatedAt: now,
  };
}

/**
 * Creates a variant under a product and refreshes the product's summary in one transaction.
 *
 * The transaction reads the product and the existing variants **first** (Firestore forbids a
 * read after a write), merges the new variant into the set in memory, then writes both the
 * variant and the refreshed product summary. So adding a cheaper variant immediately moves
 * the product's "from" price with no separate reconciliation step.
 */
export async function createVariant(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
  variant: VariantDoc,
): Promise<{ readonly id: string }> {
  requireStaff(caller, PRODUCT_RESOURCE);

  const productRef = ctx.db.doc(paths.product(productId)).withConverter(converters.products);
  const variantsRef = ctx.db
    .collection(paths.variants(productId))
    .withConverter(converters.variants);
  const variantRef = ctx.db.collection(paths.variants(productId)).doc();

  await ctx.db.runTransaction(async (tx) => {
    // All reads first.
    const [productSnap, variantsSnap] = await Promise.all([
      tx.get(productRef),
      tx.get(variantsRef),
    ]);
    const product = productSnap.data();
    if (product === undefined) {
      throw new ProductNotFoundError(productId);
    }

    // Merge the pending variant in memory — a `tx.get` would not see this uncommitted write.
    const variants: VariantWithId[] = [
      ...variantsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      { id: variantRef.id, data: variant },
    ];

    // All writes.
    tx.set(variantRef.withConverter(converters.variants), variant);
    tx.set(productRef, productWithRefreshedSummary(product, variants, ctx.clock.now()));
  });

  return { id: variantRef.id };
}

/** The variant fields an admin may edit. */
export interface VariantEditablePatch {
  readonly name: string;
  readonly sku: VariantDoc['sku'];
  readonly priceMinor: VariantDoc['priceMinor'];
  readonly mrpMinor: VariantDoc['mrpMinor'];
  readonly options: VariantDoc['options'];
  readonly active: boolean;
  readonly weightGrams: number;
}

/**
 * Updates a variant and refreshes the product summary in one transaction.
 *
 * The same consistency guarantee as create: a price change or an activation flips the
 * product's denormalised fields atomically, so a listing card and the variant can never
 * disagree about the price.
 */
export async function updateVariant(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
  variantId: string,
  patch: VariantEditablePatch,
): Promise<void> {
  requireStaff(caller, PRODUCT_RESOURCE);

  const productRef = ctx.db.doc(paths.product(productId)).withConverter(converters.products);
  const variantsRef = ctx.db
    .collection(paths.variants(productId))
    .withConverter(converters.variants);
  const variantRef = ctx.db
    .doc(paths.variant(productId, variantId))
    .withConverter(converters.variants);

  await ctx.db.runTransaction(async (tx) => {
    // All reads first: the product, and every variant (so the summary can be recomputed).
    const [productSnap, variantsSnap] = await Promise.all([
      tx.get(productRef),
      tx.get(variantsRef),
    ]);
    const product = productSnap.data();
    if (product === undefined) {
      throw new ProductNotFoundError(productId);
    }
    const existing = variantsSnap.docs.find((doc) => doc.id === variantId)?.data();
    if (existing === undefined) {
      throw new VariantNotFoundError(productId, variantId);
    }

    const updated: VariantDoc = {
      ...existing,
      name: patch.name,
      sku: patch.sku,
      priceMinor: patch.priceMinor,
      mrpMinor: patch.mrpMinor,
      options: { ...patch.options },
      active: patch.active,
      weightGrams: patch.weightGrams,
      updatedAt: ctx.clock.now(),
    };

    // Apply the update to the in-memory variant set for the summary recompute.
    const variants: VariantWithId[] = variantsSnap.docs.map((doc) =>
      doc.id === variantId ? { id: variantId, data: updated } : { id: doc.id, data: doc.data() },
    );

    // All writes.
    tx.set(variantRef, updated);
    tx.set(productRef, productWithRefreshedSummary(product, variants, ctx.clock.now()));
  });
}

/** Raised when a variant write targets a variant that does not exist. */
export class VariantNotFoundError extends Error {
  readonly productId: string;
  readonly variantId: string;
  constructor(productId: string, variantId: string) {
    super(`Variant "${variantId}" of product "${productId}" does not exist.`);
    this.name = 'VariantNotFoundError';
    this.productId = productId;
    this.variantId = variantId;
  }
}

/**
 * The fields the media finalize Function writes back onto a product's `MediaItem`.
 *
 * The upload stores a placeholder media entry with the object path and 1×1 sentinel
 * dimensions (the schema requires positive integers, so zero is not representable — a 1×1
 * entry reads as "pending" and reserves negligible layout space); the finalize Function
 * (Task 12's Cloud Function) re-derives the real type, generates the resized variants and
 * the blurhash, and calls this to fill in the true dimensions — or, on a magic-byte
 * mismatch, removes the entry entirely so a quarantined file never renders.
 */
export interface MediaFinalizeUpdate {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly blurhash: string | null;
}

/**
 * Appends a pending media entry to a product.
 *
 * Called when an admin registers an upload slot: the entry carries the allocated object
 * path and 1×1 sentinel dimensions, and its order is normalised so it lands after the
 * existing media (the caller passes a large order value; `normaliseMediaOrder` renumbers to
 * a contiguous sequence). The file itself is uploaded to the path by the client SDK, and the
 * finalize Function later fills the real dimensions or quarantines the entry.
 */
export async function registerMediaSlot(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
  pending: MediaItem,
): Promise<void> {
  requireStaff(caller, PRODUCT_RESOURCE);

  const ref = ctx.db.doc(paths.product(productId)).withConverter(converters.products);

  await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (current === undefined) {
      throw new ProductNotFoundError(productId);
    }

    tx.set(ref, {
      ...current,
      media: [...normaliseMediaOrder([...current.media, pending])],
      updatedAt: ctx.clock.now(),
    });
  });
}

/**
 * Applies media metadata discovered on object finalize, or removes a quarantined entry.
 *
 * Called by the finalize Function with the `system` caller (no human behind it). When
 * `update` is provided, it fills in the dimensions and blurhash on the matching media entry;
 * when `null`, it removes the entry — the file failed the magic-byte re-derivation and must
 * not reach a product page. Either way the media order is renormalised so the cover stays
 * unambiguous.
 */
export async function finalizeProductMedia(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
  objectPath: string,
  update: MediaFinalizeUpdate | null,
): Promise<void> {
  requireStaff(caller, PRODUCT_RESOURCE);

  const ref = ctx.db.doc(paths.product(productId)).withConverter(converters.products);

  await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (current === undefined) {
      throw new ProductNotFoundError(productId);
    }

    const kept =
      update === null
        ? // Quarantine: drop the entry whose upload failed re-derivation.
          current.media.filter((item) => item.path !== objectPath)
        : current.media.map((item) =>
            item.path === objectPath
              ? { ...item, width: update.width, height: update.height, blurhash: update.blurhash }
              : item,
          );

    tx.set(ref, {
      ...current,
      media: [...normaliseMediaOrder(kept)],
      updatedAt: ctx.clock.now(),
    });
  });
}

/** The type of a decoded product with its ID, for callers assembling responses. */
export type ProductWithId = WithId<ProductDoc>;
