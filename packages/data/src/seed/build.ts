import {
  CHECKOUT_SETTINGS_ID,
  money,
  type CategoryDoc,
  type CheckoutSettingsDoc,
  type CounterDoc,
  type Instant,
  type InventoryDoc,
  type InventoryLedgerDoc,
  type MediaItem,
  type ProductDoc,
  type VariantDoc,
  type VariantSummary,
  type WarehouseDoc,
} from '@romp/contracts';
import type { CatalogueProduct, CatalogueSeed, StoreConfig } from '@romp/store-config';

import type { Clock } from '../clock';
import { FIXED_DOCUMENT_IDS, paths } from '../paths';
import { buildSearchTokens } from '../search-tokens';

import type { SeedPlan, SeedWrite } from './plan';

/**
 * Store config in, Firestore documents out.
 *
 * Pure: same config plus same clock produces byte-identical output, every time. That
 * is what makes the seed re-runnable, and it is why the clock is a parameter rather
 * than a `new Date()` call — a seed that stamps a fresh timestamp on every run rewrites
 * every document on every run, so "did anything change" becomes unanswerable.
 *
 * **Document IDs are natural keys**, not Firestore auto-IDs:
 *
 * | Collection   | ID              |
 * | ------------ | --------------- |
 * | `categories` | category slug   |
 * | `products`   | product slug    |
 * | `variants`   | variant SKU     |
 * | `inventory`  | variant SKU     |
 * | `warehouses` | warehouse code  |
 *
 * `DATA_MODEL.md` specifies auto-IDs for products and categories, and this deviates
 * deliberately: an auto-ID makes the seed non-idempotent, because a second run cannot
 * tell which existing document corresponds to which entry in the file and creates a
 * duplicate of everything. Natural keys make a re-run an update. Nothing depends on
 * `productId === slug` — the slug can be edited in admin afterwards and the ID simply
 * stops matching, which is fine because IDs are opaque everywhere they are used.
 * Products created through admin still get auto-IDs.
 */

/** The `settings/checkout` seed, which initialises but does not own the document. */
function buildCheckoutSettings(config: StoreConfig, now: Instant): CheckoutSettingsDoc {
  return {
    reservationTtlMinutes: config.commerce.reservationTtlMinutes,
    giftWrapFeeMinor: config.commerce.giftWrapFeeMinor,
    expressFeeMinor: config.commerce.expressFeeMinor,
    freeShippingThresholdMinor: config.commerce.freeShippingThresholdMinor,
    standardShippingFeeMinor: config.commerce.standardShippingFeeMinor,
    gstRateBasisPoints: config.locale.gstRateBasisPoints,
    upi: { vpa: config.commerce.upi.vpa, payeeName: config.commerce.upi.payeeName },
    lowStockThreshold: config.commerce.lowStockThreshold,
    updatedAt: now,
    updatedBy: 'system',
  };
}

function buildWarehouses(config: StoreConfig, now: Instant): readonly SeedWrite<WarehouseDoc>[] {
  // Iterated, never indexed. A single-warehouse store and a five-warehouse store run
  // this identically, which is the whole point of warehouses being data.
  return config.warehouses.map((warehouse) => ({
    path: paths.warehouse(warehouse.code),
    converter: 'warehouses',
    mode: 'overwrite',
    label: `warehouse ${warehouse.code} (${warehouse.name})`,
    data: {
      code: warehouse.code as WarehouseDoc['code'],
      name: warehouse.name,
      city: warehouse.city,
      pincode: warehouse.pincode as WarehouseDoc['pincode'],
      priority: warehouse.priority,
      active: warehouse.active,
      servicePincodePrefixes: [...warehouse.servicePincodePrefixes],
      createdAt: now,
      updatedAt: now,
    },
  }));
}

/**
 * Counts products per category, rolling child counts up into the parent.
 *
 * A product in `sensory` counts for `sensory` *and* for its parent `wooden`. Direct
 * counts only would show "Wooden toys (0)" in the nav while its subcategory has
 * products in it, which reads as a bug rather than as a taxonomy decision.
 *
 * Only `active` products are counted — a draft appearing in a facet count that no
 * listing can produce is worse than no count.
 */
function countProductsByCategory(
  config: StoreConfig,
  catalogue: CatalogueSeed | null,
): ReadonlyMap<string, number> {
  const parentOf = new Map(
    config.content.categories.map((category) => [category.slug, category.parent ?? null]),
  );
  const counts = new Map<string, number>(
    config.content.categories.map((category) => [category.slug, 0]),
  );

  for (const product of catalogue?.products ?? []) {
    if (product.status !== 'active') continue;

    // Walk up the tree. The config schema already guarantees one level of nesting, so
    // this terminates, but following the links rather than assuming a depth means a
    // future deeper tree does not silently produce wrong counts.
    let slug: string | null = product.category;
    const visited = new Set<string>();
    while (slug !== null && !visited.has(slug)) {
      visited.add(slug);
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
      slug = parentOf.get(slug) ?? null;
    }
  }

  return counts;
}

function buildCategories(
  config: StoreConfig,
  catalogue: CatalogueSeed | null,
  now: Instant,
): readonly SeedWrite<CategoryDoc>[] {
  const counts = countProductsByCategory(config, catalogue);

  return config.content.categories.map((category) => ({
    path: paths.category(category.slug),
    converter: 'categories',
    mode: 'overwrite',
    label: `category ${category.slug} (${category.name})`,
    data: {
      name: category.name,
      slug: category.slug as CategoryDoc['slug'],
      // Categories are keyed by slug, so the parent reference is the parent's slug.
      parentId: (category.parent ?? null) as CategoryDoc['parentId'],
      active: category.active,
      showInFilters: category.showInFilters,
      showInNav: category.showInNav,
      productCount: counts.get(category.slug) ?? 0,
      sortOrder: category.sortOrder,
      createdAt: now,
      updatedAt: now,
    },
  }));
}

/** Total opening units for a variant, across every warehouse. */
function totalStock(stock: Readonly<Record<string, number>>): number {
  return Object.values(stock).reduce((total, units) => total + units, 0);
}

function buildVariantSummary(product: CatalogueProduct): readonly VariantSummary[] {
  return product.variants.map((variant) => ({
    variantId: variant.sku as VariantSummary['variantId'],
    name: variant.name,
    sku: variant.sku as VariantSummary['sku'],
    priceMinor: money(variant.priceMinor),
    mrpMinor: money(variant.mrpMinor),
    active: variant.active,
    // A boolean, never a count: exact stock is staff-only, and the number would be
    // stale by the time anyone acted on it anyway.
    inStock: totalStock(variant.stock) > 0,
  }));
}

/**
 * Picks the price shown on a listing card, and the MRP that belongs with it.
 *
 * The MRP has to come from the *same* variant as the price, or the strike-through
 * discount is computed across two different products' worth of pricing and can even
 * come out negative.
 *
 * Active variants only when there are any, because that is what a customer can buy.
 * A draft product with everything inactive still needs a price to render in admin, so
 * it falls back to the full set.
 */
function priceFrom(product: CatalogueProduct): { priceMinor: number; mrpMinor: number } {
  const sellable = product.variants.filter((variant) => variant.active);
  const candidates = sellable.length > 0 ? sellable : product.variants;

  const cheapest = candidates.reduce((best, variant) =>
    variant.priceMinor < best.priceMinor ? variant : best,
  );

  return { priceMinor: cheapest.priceMinor, mrpMinor: cheapest.mrpMinor };
}

function buildMedia(product: CatalogueProduct): readonly MediaItem[] {
  return product.media.map((item, index) => ({
    // A Storage object path, not a download URL: a URL embeds a token that rotates
    // when the object is replaced, so a stored URL breaks on the next upload.
    path: `${paths.product(product.slug)}/${item.file}`,
    alt: item.alt,
    width: item.width,
    height: item.height,
    // Produced by the resize Function on upload, so null until that has run.
    blurhash: null,
    order: index,
  }));
}

function buildProduct(product: CatalogueProduct, config: StoreConfig, now: Instant): ProductDoc {
  const { priceMinor, mrpMinor } = priceFrom(product);
  const ageBandLabel =
    config.content.ageBands.find((band) => band.value === product.ageBand)?.label ??
    product.ageBand;
  const categoryName =
    config.content.categories.find((category) => category.slug === product.category)?.name ??
    product.category;

  return {
    slug: product.slug as ProductDoc['slug'],
    name: product.name,
    description: product.description,
    brand: product.brand,
    // Categories are keyed by slug, so the ID and the denormalised slug coincide here.
    // They are still two fields, because an admin-created category gets an auto-ID and
    // the listing query filters on the slug.
    categoryId: product.category as ProductDoc['categoryId'],
    categorySlug: product.category as ProductDoc['categorySlug'],
    ageBand: product.ageBand as ProductDoc['ageBand'],
    status: product.status,
    badge: product.badge,

    priceFromMinor: money(priceMinor),
    mrpFromMinor: money(mrpMinor),
    variantSummary: [...buildVariantSummary(product)],

    media: [...buildMedia(product)],
    skills: [...product.skills],
    boxItems: [...product.boxItems],
    safety: {
      bisCertified: product.safety.bisCertified,
      bisCertNo: product.safety.bisCertNo,
      // An ISO date in the seed file, an instant in Firestore. Parsed as UTC midnight
      // so the stored value does not depend on the machine running the seed.
      bisCertExpiry:
        product.safety.bisCertExpiry === null
          ? null
          : new Date(`${product.safety.bisCertExpiry}T00:00:00.000Z`),
      bpaFree: product.safety.bpaFree,
      hasSmallParts: product.safety.hasSmallParts,
    },

    // A freshly seeded product has no reviews. Seeding a flattering average would be
    // inventing social proof.
    ratingAvg: 0,
    ratingCount: 0,

    searchTokens: [...buildSearchTokens([product.name, product.brand, categoryName, ageBandLabel])],
    seo: {
      title: null,
      description: null,
      // A draft must not be indexed. If it were, de-indexing after publication
      // decisions change is slow and partly out of our hands.
      index: product.status === 'active',
    },

    createdAt: now,
    updatedAt: now,
    publishedAt: product.status === 'active' ? now : null,
  };
}

function buildVariant(
  product: CatalogueProduct,
  variant: CatalogueProduct['variants'][number],
  now: Instant,
): VariantDoc {
  return {
    productId: product.slug as VariantDoc['productId'],
    name: variant.name,
    sku: variant.sku as VariantDoc['sku'],
    priceMinor: money(variant.priceMinor),
    mrpMinor: money(variant.mrpMinor),
    options: { ...variant.options },
    active: variant.active,
    weightGrams: variant.weightGrams,
    createdAt: now,
    updatedAt: now,
  };
}

function buildInventory(
  product: CatalogueProduct,
  variant: CatalogueProduct['variants'][number],
  config: StoreConfig,
  now: Instant,
): InventoryDoc {
  const stock = Object.fromEntries(
    Object.entries(variant.stock).filter(([, units]) => units > 0),
  ) as InventoryDoc['stock'];

  return {
    productId: product.slug as InventoryDoc['productId'],
    stock,
    onHandTotal: totalStock(stock),
    // A freshly seeded store has no live orders, so nothing is held.
    reserved: 0,
    lowStockThreshold: config.commerce.lowStockThreshold,
    updatedAt: now,
  };
}

/**
 * Opening-balance ledger entries, one per warehouse holding stock.
 *
 * The ledger is append-only in operation, and these entries are what make the opening
 * balance explainable rather than appearing from nowhere: without them, the first
 * reconciliation finds stock the ledger cannot account for.
 *
 * The entry ID is derived from the SKU and warehouse, so a re-run overwrites the same
 * entry rather than appending a second opening balance. That is the one place the seed
 * writes an append-only collection non-additively, and it is why the seed is an
 * *initialisation* tool: after launch, stock changes go through the admin adjustment
 * path, which appends.
 */
function buildLedgerEntries(
  storeId: string,
  product: CatalogueProduct,
  variant: CatalogueProduct['variants'][number],
  now: Instant,
): readonly SeedWrite<InventoryLedgerDoc>[] {
  return Object.entries(variant.stock)
    .filter(([, units]) => units > 0)
    .map(([warehouseId, units]) => ({
      path: paths.ledgerEntry(`seed_${variant.sku}_${warehouseId}`),
      converter: 'inventoryLedger',
      mode: 'overwrite' as const,
      label: `opening balance ${variant.sku} @ ${warehouseId} (${String(units)})`,
      data: {
        variantId: variant.sku as InventoryLedgerDoc['variantId'],
        productId: product.slug as InventoryLedgerDoc['productId'],
        warehouseId: warehouseId as InventoryLedgerDoc['warehouseId'],
        delta: units,
        reason: 'seed',
        actorId: 'system',
        refId: null,
        note: `Opening balance from stores/${storeId}/seed.catalogue.ts`,
        at: now,
      },
    }));
}

function buildCatalogueWrites(
  storeId: string,
  config: StoreConfig,
  catalogue: CatalogueSeed,
  now: Instant,
): readonly SeedWrite[] {
  const writes: SeedWrite[] = [];

  for (const product of catalogue.products) {
    writes.push({
      path: paths.product(product.slug),
      converter: 'products',
      mode: 'overwrite',
      label: `product ${product.slug}`,
      data: buildProduct(product, config, now),
    } satisfies SeedWrite<ProductDoc>);

    for (const variant of product.variants) {
      writes.push({
        path: paths.variant(product.slug, variant.sku),
        converter: 'variants',
        mode: 'overwrite',
        label: `variant ${variant.sku}`,
        data: buildVariant(product, variant, now),
      } satisfies SeedWrite<VariantDoc>);

      writes.push({
        path: paths.inventory(variant.sku),
        converter: 'inventory',
        mode: 'overwrite',
        label: `inventory ${variant.sku}`,
        data: buildInventory(product, variant, config, now),
      } satisfies SeedWrite<InventoryDoc>);

      writes.push(...buildLedgerEntries(storeId, product, variant, now));
    }
  }

  return writes;
}

/**
 * The order-number counter's starting value.
 *
 * Not zero. `HumanOrderIdSchema` requires at least four digits, and starting at 1 would
 * also tell the first customer they are the first customer — a number that is a
 * business disclosure as well as an awkward one.
 */
const ORDER_NUMBER_START = 1_000;

/**
 * Builds the complete seed plan.
 *
 * `catalogue` is nullable because `seed.catalogue.ts` is optional: a store importing
 * its products from elsewhere still needs its warehouses, categories, settings and
 * counter, and should not have to invent a product to get them.
 */
export function buildSeedPlan(options: {
  readonly storeId: string;
  readonly config: StoreConfig;
  readonly catalogue: CatalogueSeed | null;
  readonly clock: Clock;
}): SeedPlan {
  const { storeId, config, catalogue, clock } = options;
  const now = clock.now();

  const writes: SeedWrite[] = [
    ...buildWarehouses(config, now),
    {
      path: paths.checkoutSettings(),
      converter: 'checkoutSettings',
      // Initialised, not owned. Overwriting would mean every seed run silently
      // reverts a fee change somebody made in admin on purpose.
      mode: 'createIfAbsent',
      label: `settings/${CHECKOUT_SETTINGS_ID}`,
      data: buildCheckoutSettings(config, now),
    } satisfies SeedWrite<CheckoutSettingsDoc>,
    {
      path: paths.orderHumanIdCounter(),
      converter: 'counters',
      // Absolutely create-only. Resetting this would re-issue order numbers that
      // customers already have, and the sequence is what they quote on WhatsApp.
      mode: 'createIfAbsent',
      label: `counters/${FIXED_DOCUMENT_IDS.orderHumanIdCounter}`,
      data: { value: ORDER_NUMBER_START, updatedAt: now },
    } satisfies SeedWrite<CounterDoc>,
    ...buildCategories(config, catalogue, now),
  ];

  if (catalogue !== null) {
    writes.push(...buildCatalogueWrites(storeId, config, catalogue, now));
  }

  return { storeId, writes };
}
