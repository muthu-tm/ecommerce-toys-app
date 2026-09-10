import type {
  CategoryDoc,
  CheckoutSettingsDoc,
  ProductDoc,
  VariantDoc,
  VariantOption,
  WarehouseDoc,
} from '@romp/contracts';
import { PUBLIC_PRODUCT_STATUS, VariantIdSchema } from '@romp/contracts';

import type { Caller, StoreContext } from '../context';
import { isStaff, requireStaff } from '../context';
import type { WithId } from '../converter';
import { converters } from '../converters';
import { COLLECTIONS, paths } from '../paths';

import { getDocument, getDocuments, runQuery } from './read';

/**
 * The catalogue read paths.
 *
 * Everything here mirrors a rule in `infra/firestore.rules`, and the mirroring is the
 * point. These reads go through the Admin SDK, which does not consult that file — so a
 * server component calling `findProductBySlug` for an anonymous visitor is only
 * protected by the status filter written here. The rules and these functions have to
 * agree, and where they disagree, this is the one that decides what a customer sees.
 *
 * `PUBLIC_PRODUCT_STATUS` is the shared constant rather than a `'active'` literal, for
 * exactly that reason.
 */

/** Whether this caller may see products that are not `active`. */
function canSeeUnpublished(caller: Caller): boolean {
  return isStaff(caller);
}

/**
 * Finds a product by its URL slug.
 *
 * Returns `null` for a draft or archived product when the caller is not staff, so a
 * guessed slug is indistinguishable from a slug that never existed — the same
 * 404-not-403 reasoning that governs owned resources.
 *
 * A query rather than a `get`, because the slug is not the document ID for
 * admin-created products (only seeded ones coincide). Backed by the single-field index
 * Firestore maintains automatically.
 */
export async function findProductBySlug(
  ctx: StoreContext,
  caller: Caller,
  slug: string,
): Promise<WithId<ProductDoc> | null> {
  const results = await runQuery(
    ctx.db
      .collection(COLLECTIONS.products)
      .withConverter(converters.products)
      .where('slug', '==', slug)
      .limit(1),
  );

  const product = results[0];
  if (product === undefined) return null;
  if (product.status !== PUBLIC_PRODUCT_STATUS && !canSeeUnpublished(caller)) return null;

  return product;
}

/** Finds a product by document ID, with the same visibility rule. */
export async function findProductById(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
): Promise<WithId<ProductDoc> | null> {
  const product = await getDocument(ctx, paths.product(productId), converters.products);

  if (product === null) return null;
  if (product.status !== PUBLIC_PRODUCT_STATUS && !canSeeUnpublished(caller)) return null;

  return product;
}

/**
 * Reads several products by ID, dropping any the caller may not see.
 *
 * For a cart, an order's reorder flow, or a "recently viewed" rail — anywhere a list of
 * IDs exists and the products behind them are needed in one round trip. Silently
 * dropping rather than throwing is right here: a cart containing a since-archived
 * product should render the rest of the cart, not fail.
 */
export async function findProductsByIds(
  ctx: StoreContext,
  caller: Caller,
  productIds: readonly string[],
): Promise<readonly WithId<ProductDoc>[]> {
  const products = await getDocuments(
    ctx,
    productIds.map((id) => paths.product(id)),
    converters.products,
  );

  if (canSeeUnpublished(caller)) return products;

  return products.filter((product) => product.status === PUBLIC_PRODUCT_STATUS);
}

/**
 * Lists a product's variants.
 *
 * Inactive variants are hidden from customers but **not** deleted, so an order that
 * references one still resolves. Staff see everything, because an inactive variant is
 * something they have to be able to find in order to reactivate it.
 */
export async function listVariants(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
): Promise<readonly WithId<VariantDoc>[]> {
  const variants = await runQuery(
    ctx.db
      .collection(paths.variants(productId))
      .withConverter(converters.variants)
      .orderBy('priceMinor', 'asc'),
  );

  if (isStaff(caller)) return variants;

  return variants.filter((variant) => variant.active);
}

/**
 * Lists products for the backoffice, newest first, across every status.
 *
 * Staff-only: it returns drafts and archived products, which the public reads must never
 * surface. The 404-not-403 rule of `requireStaff` applies — a non-staff caller gets a
 * not-found-shaped rejection rather than a confirmation that a backoffice exists. Bounded by
 * `limit` because the backoffice list is paginated in the UI; a full-catalogue scan is not
 * something an admin page needs in one read.
 */
export async function listAllProducts(
  ctx: StoreContext,
  caller: Caller,
  limit: number,
): Promise<readonly WithId<ProductDoc>[]> {
  requireStaff(caller, { resource: 'products' });

  return runQuery(
    ctx.db
      .collection(COLLECTIONS.products)
      .withConverter(converters.products)
      .orderBy('updatedAt', 'desc')
      .limit(limit),
  );
}

/**
 * Builds the variant selector for a product detail page.
 *
 * Availability comes from `inventory`, which is **staff-only** — so it is derived here,
 * server-side, and only the boolean crosses the boundary. This is the function that
 * keeps exact stock counts off a public page while still letting the page say
 * "out of stock" truthfully.
 *
 * Reads the product's own `variantSummary` for nothing: the summary carries a
 * denormalised `inStock` maintained by the variant transaction, but a PDP is worth one
 * fresh read per variant, because "in stock" on the page a customer is about to buy
 * from should not be a value that could be minutes stale.
 */
export async function listVariantOptions(
  ctx: StoreContext,
  caller: Caller,
  productId: string,
): Promise<readonly VariantOption[]> {
  const variants = await listVariants(ctx, caller, productId);
  if (variants.length === 0) return [];

  const inventory = await getDocuments(
    ctx,
    variants.map((variant) => paths.inventory(variant.id)),
    converters.inventory,
  );
  const availableByVariant = new Map(
    inventory.map((record) => [record.id, record.onHandTotal - record.reserved]),
  );

  return variants.map((variant) => ({
    // The document ID, not the SKU. They coincide for seeded variants and diverge for
    // admin-created ones, and it is the document ID that addresses the inventory record.
    id: VariantIdSchema.parse(variant.id),
    name: variant.name,
    sku: variant.sku,
    priceMinor: variant.priceMinor,
    mrpMinor: variant.mrpMinor,
    options: variant.options,
    active: variant.active,
    // Missing inventory means no record has been created yet, which is genuinely no
    // stock — not an error, and not a reason to claim availability.
    inStock: (availableByVariant.get(variant.id) ?? 0) > 0,
  }));
}

/**
 * Every category, ordered for display.
 *
 * Categories are publicly readable in full — they are navigation metadata, on every
 * page of the storefront — so there is no caller-dependent filtering here. What
 * `showInNav` and `showInFilters` decide is *where* a category appears, which is the
 * caller's business, not this function's.
 */
export async function listCategories(ctx: StoreContext): Promise<readonly WithId<CategoryDoc>[]> {
  return runQuery(
    ctx.db
      .collection(COLLECTIONS.categories)
      .withConverter(converters.categories)
      .orderBy('sortOrder', 'asc'),
  );
}

/**
 * Categories flagged for the storefront header.
 *
 * Inactive categories are excluded: `active` is filtered in memory rather than added to the
 * query, because a `showInNav + active + sortOrder` composite index for a collection that holds
 * a handful of documents is cost the tiny result set does not justify. The existing
 * `showInNav + sortOrder` index still does the ordering and the bulk of the narrowing.
 */
export async function listNavCategories(
  ctx: StoreContext,
): Promise<readonly WithId<CategoryDoc>[]> {
  const results = await runQuery(
    ctx.db
      .collection(COLLECTIONS.categories)
      .withConverter(converters.categories)
      .where('showInNav', '==', true)
      .orderBy('sortOrder', 'asc'),
  );
  return results.filter((category) => category.active);
}

/** Categories flagged for the listing sidebar. Inactive ones are filtered out (see `listNavCategories`). */
export async function listFilterCategories(
  ctx: StoreContext,
): Promise<readonly WithId<CategoryDoc>[]> {
  const results = await runQuery(
    ctx.db
      .collection(COLLECTIONS.categories)
      .withConverter(converters.categories)
      .where('showInFilters', '==', true)
      .orderBy('sortOrder', 'asc'),
  );
  return results.filter((category) => category.active);
}

export async function findCategoryBySlug(
  ctx: StoreContext,
  slug: string,
): Promise<WithId<CategoryDoc> | null> {
  const results = await runQuery(
    ctx.db
      .collection(COLLECTIONS.categories)
      .withConverter(converters.categories)
      .where('slug', '==', slug)
      .limit(1),
  );

  return results[0] ?? null;
}

/**
 * The live commerce parameters.
 *
 * Publicly readable, because every value is shown to the customer before they pay.
 * Returns `null` when the store has not been seeded, and the caller decides what that
 * means — a checkout page must refuse to render, while a footer showing a
 * free-shipping threshold can simply omit it. Substituting the store config's values as
 * a fallback would be worse: the whole point of this document is that it can be edited
 * without a deploy, so a silent fallback would quote a fee that is no longer charged.
 */
export async function getCheckoutSettings(
  ctx: StoreContext,
): Promise<WithId<CheckoutSettingsDoc> | null> {
  return getDocument(ctx, paths.checkoutSettings(), converters.checkoutSettings);
}

/**
 * Warehouses, staff only.
 *
 * The storefront never needs these: a delivery estimate is computed server-side from
 * `servicePincodePrefixes` and only the resulting date crosses the boundary. Exposing
 * the list would publish the store's operational geography.
 */
export async function listWarehouses(
  ctx: StoreContext,
  caller: Caller,
): Promise<readonly WithId<WarehouseDoc>[]> {
  requireStaff(caller, { resource: 'warehouses' });

  return runQuery(
    ctx.db
      .collection(COLLECTIONS.warehouses)
      .withConverter(converters.warehouses)
      .orderBy('priority', 'asc'),
  );
}

/**
 * Active warehouses, in allocation order.
 *
 * A separate function rather than a flag, because "which warehouses can this order ship
 * from" and "which warehouses exist" are different questions and the allocator must
 * never accidentally ask the second. `system` is a staff caller, so the allocator and
 * the sweeper can both use this.
 */
export async function listAllocatableWarehouses(
  ctx: StoreContext,
  caller: Caller,
): Promise<readonly WithId<WarehouseDoc>[]> {
  const warehouses = await listWarehouses(ctx, caller);

  return warehouses.filter((warehouse) => warehouse.active);
}
