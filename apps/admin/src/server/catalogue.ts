import 'server-only';

import { cache } from 'react';

import type {
  CategoryDoc,
  InventoryDoc,
  ProductDoc,
  VariantDoc,
  WarehouseDoc,
} from '@romp/contracts';
import {
  asSystem,
  createStoreContext,
  findInventory,
  findProductById,
  listAllProducts,
  listCategories,
  listVariants,
  listWarehouses,
  systemClock,
} from '@romp/data';
import type { Caller, StoreContext, WithId } from '@romp/data';

import { catalogueAvailable, db, storeId } from './firebase';

/**
 * The backoffice's read layer.
 *
 * Everything the admin pages read comes through here, and nothing is exported to a client
 * component (`import 'server-only'`). It mirrors the storefront's server layer with one
 * deliberate difference: the caller is a **staff** caller, not `ANONYMOUS`, so these reads
 * see drafts and archived products the public storefront cannot.
 *
 * The caller is `asSystem` for server rendering in v1.0. The admin origin is itself access-
 * controlled — it is a separate, sign-in-gated App Hosting backend — and per-operator
 * identity for reads arrives with client auth (Task 20), at which point the verified operator
 * uid replaces the system caller here. `asSystem` satisfies `isStaff`, so the reads return
 * the full catalogue today; what changes later is whose uid is attributed, not what is
 * visible.
 */
const context = cache((): StoreContext =>
  createStoreContext({ storeId: storeId(), db: db(), clock: systemClock }),
);

/** The staff caller the backoffice reads as. Replaced by the verified operator in Task 20. */
const caller: Caller = asSystem('backoffice read');

/** How many products the list page shows. Pagination in the UI is a roadmap refinement. */
const PRODUCT_LIST_LIMIT = 200;

/**
 * The product list for the backoffice, newest edit first, across every status.
 *
 * Returns an empty list at build time (no datastore reachable), so the list page prerenders
 * a shell and fills it on the first request — the same degradation the storefront uses.
 */
export const listProducts = cache(async (): Promise<readonly WithId<ProductDoc>[]> => {
  if (!catalogueAvailable()) return [];
  return listAllProducts(context(), caller, PRODUCT_LIST_LIMIT);
});

/**
 * One product with its variants, for the edit page.
 *
 * Returns null for a missing product (or at build time) so the page renders a not-found
 * rather than throwing. Reads variants including inactive ones, because the editor must be
 * able to reactivate them.
 */
export const getProductForEdit = cache(
  async (
    productId: string,
  ): Promise<{
    readonly product: WithId<ProductDoc>;
    readonly variants: readonly WithId<VariantDoc>[];
  } | null> => {
    if (!catalogueAvailable()) return null;
    const product = await findProductById(context(), caller, productId);
    if (product === null) return null;
    const variants = await listVariants(context(), caller, product.id);
    return { product, variants };
  },
);

/** The category tree, for the create/edit form's category selector. */
export const getCategories = cache(async (): Promise<readonly WithId<CategoryDoc>[]> => {
  if (!catalogueAvailable()) return [];
  return listCategories(context());
});

/**
 * The seeded warehouses, in allocation order, for the inventory editor.
 *
 * The full list rather than only the allocatable ones: an operator must be able to adjust a
 * warehouse that is currently inactive — correcting its stock is exactly the kind of thing done
 * while it is out of the allocation rotation.
 */
export const getWarehouses = cache(async (): Promise<readonly WithId<WarehouseDoc>[]> => {
  if (!catalogueAvailable()) return [];
  return listWarehouses(context(), caller);
});

/**
 * One variant's inventory record, for the inventory editor's per-warehouse counts.
 *
 * Keyed by variant ID — the inventory document ID *is* the variant ID — so this is a single
 * read per variant. Null when the variant has no stock yet; the editor renders every warehouse
 * at zero in that case, which is also the first adjustment's starting point.
 */
export const getVariantInventory = cache(
  async (variantId: string): Promise<WithId<InventoryDoc> | null> => {
    if (!catalogueAvailable()) return null;
    return findInventory(context(), caller, variantId);
  },
);
