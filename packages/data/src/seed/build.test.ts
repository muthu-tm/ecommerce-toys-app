import { describe, expect, it } from 'vitest';

import {
  CategoryDocSchema,
  CheckoutSettingsDocSchema,
  CounterDocSchema,
  InventoryDocSchema,
  InventoryLedgerDocSchema,
  ProductDocSchema,
  VariantDocSchema,
  WarehouseDocSchema,
} from '@romp/contracts';
import type { CatalogueSeed, StoreConfig } from '@romp/store-config';
import { loadCatalogueSeed, loadStoreConfig } from '@romp/store-config/loader';

import { fixedClock } from '../clock';
import { converters } from '../converters';
import { paths } from '../paths';

import { buildSeedPlan } from './build';
import { assertNoDuplicatePaths, summarisePlan } from './plan';
import type { SeedPlan, SeedWrite } from './plan';

/**
 * The seed builders.
 *
 * Run against the **real** store configs and catalogues, not fixtures. That is
 * deliberate: a fixture would let the builders and the shipped configs drift apart, and
 * the failure mode of that drift is a seed that works in tests and throws on the first
 * real run. Both stores are covered, because `_template` is a genuinely different
 * configuration — one warehouse instead of two, different categories, different age
 * bands — and a builder that had quietly assumed ROMP's shape fails there.
 */

const clock = fixedClock(new Date('2026-03-01T09:30:00.000Z'));
const now = clock.now();

const romp = await loadStoreConfig('romp');
const rompCatalogue = await loadCatalogueSeed('romp', romp);
const template = await loadStoreConfig('_template', { allowScaffold: true });
const templateCatalogue = await loadCatalogueSeed('_template', template);

function planFor(storeId: string, config: StoreConfig, catalogue: CatalogueSeed | null): SeedPlan {
  return buildSeedPlan({ storeId, config, catalogue, clock });
}

const rompPlan = planFor('romp', romp, rompCatalogue);
const templatePlan = planFor('_template', template, templateCatalogue);

function writesFor(plan: SeedPlan, converter: string): readonly SeedWrite[] {
  return plan.writes.filter((write) => write.converter === converter);
}

function writeAt(plan: SeedPlan, path: string): SeedWrite {
  const write = plan.writes.find((candidate) => candidate.path === path);
  if (write === undefined) throw new Error(`The plan has no write at ${path}`);
  return write;
}

describe('the plan is well formed', () => {
  it('writes no document twice', () => {
    // Not a Firestore error — the second write silently wins — so a builder bug that
    // derived the same ID for two products would seed a catalogue quietly missing one.
    expect(() => {
      assertNoDuplicatePaths(rompPlan);
    }).not.toThrow();
    expect(() => {
      assertNoDuplicatePaths(templatePlan);
    }).not.toThrow();
  });

  it('detects a duplicate path when there is one', () => {
    const write = rompPlan.writes[0];
    if (write === undefined) throw new Error('empty plan');

    expect(() => {
      assertNoDuplicatePaths({ storeId: 'romp', writes: [write, { ...write, label: 'again' }] });
    }).toThrow(/same document more than once/);
  });

  it('names the colliding labels, so the duplicate is identifiable', () => {
    const write = rompPlan.writes[0];
    if (write === undefined) throw new Error('empty plan');

    expect(() => {
      assertNoDuplicatePaths({
        storeId: 'romp',
        writes: [
          { ...write, label: 'first thing' },
          { ...write, label: 'second thing' },
        ],
      });
    }).toThrow(/first thing.*second thing/s);
  });

  it('every write names a converter that exists', () => {
    const known = new Set(Object.keys(converters));

    for (const write of [...rompPlan.writes, ...templatePlan.writes]) {
      expect(known.has(write.converter)).toBe(true);
    }
  });

  it('every document passes its own converter', () => {
    // The end-to-end guarantee: if this passes, `pnpm seed` cannot fail validation on
    // any document, because the writer runs these same converters.
    //
    // The converter's type is erased here for the same reason `apply.ts` erases it — a
    // plan is heterogeneous, so no single document type describes the whole list. The
    // runtime check is the point.
    const registry = converters as unknown as Readonly<
      Record<string, { toFirestore: (data: unknown) => unknown }>
    >;

    for (const write of [...rompPlan.writes, ...templatePlan.writes]) {
      const converter = registry[write.converter];
      expect(converter).toBeDefined();
      expect(() => converter?.toFirestore(write.data)).not.toThrow();
    }
  });

  it('summarises counts per collection', () => {
    const summary = summarisePlan(rompPlan);

    expect(summary.warehouses).toBe(romp.warehouses.length);
    expect(summary.categories).toBe(romp.content.categories.length);
    expect(summary.products).toBe(rompCatalogue?.products.length);
  });
});

describe('determinism', () => {
  it('produces an identical plan from an identical clock', () => {
    // This is what makes a re-run an update rather than a rewrite. A seed that stamped
    // a fresh timestamp every run would rewrite every document every time, and "did
    // anything change" would become unanswerable.
    expect(planFor('romp', romp, rompCatalogue)).toEqual(rompPlan);
  });

  it('stamps every document with the clock, not with wall time', () => {
    const warehouse = WarehouseDocSchema.parse(writeAt(rompPlan, paths.warehouse('blr')).data);

    expect(warehouse.createdAt.toISOString()).toBe('2026-03-01T09:30:00.000Z');
    expect(warehouse.updatedAt.toISOString()).toBe('2026-03-01T09:30:00.000Z');
  });

  it('sorts search tokens, so an unchanged product does not look changed', () => {
    const product = ProductDocSchema.parse(
      writeAt(rompPlan, paths.product('beechwood-stacking-rings')).data,
    );

    expect([...product.searchTokens]).toEqual([...product.searchTokens].sort());
  });
});

describe('warehouses', () => {
  it('seeds every configured warehouse, keyed by its code', () => {
    const writes = writesFor(rompPlan, 'warehouses');

    expect(writes.map((write) => write.path)).toEqual([
      paths.warehouse('blr'),
      paths.warehouse('del'),
    ]);
  });

  it('works for a single-warehouse store', () => {
    // Warehouse count is data, not a layout assumption. `_template` has one.
    const writes = writesFor(templatePlan, 'warehouses');

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(paths.warehouse('main'));
  });

  it('carries the service prefixes the delivery estimate needs', () => {
    const warehouse = WarehouseDocSchema.parse(writeAt(rompPlan, paths.warehouse('blr')).data);

    expect(warehouse.servicePincodePrefixes.length).toBeGreaterThan(0);
  });
});

describe('settings and counters', () => {
  it('seeds checkout settings from commerce and locale config', () => {
    const settings = CheckoutSettingsDocSchema.parse(
      writeAt(rompPlan, paths.checkoutSettings()).data,
    );

    expect(settings.reservationTtlMinutes).toBe(romp.commerce.reservationTtlMinutes);
    expect(settings.giftWrapFeeMinor).toBe(romp.commerce.giftWrapFeeMinor);
    expect(settings.freeShippingThresholdMinor).toBe(romp.commerce.freeShippingThresholdMinor);
    // GST lives under `locale`, not `commerce` — it is a jurisdiction fact, not a
    // commercial choice.
    expect(settings.gstRateBasisPoints).toBe(romp.locale.gstRateBasisPoints);
    expect(settings.upi.vpa).toBe(romp.commerce.upi.vpa);
  });

  it('initialises checkout settings without owning them', () => {
    // Overwriting would mean every seed run silently reverts a fee change somebody
    // made in admin on purpose.
    expect(writeAt(rompPlan, paths.checkoutSettings()).mode).toBe('createIfAbsent');
  });

  it('seeds the order-number counter create-only, above four digits', () => {
    const write = writeAt(rompPlan, paths.orderHumanIdCounter());
    const counter = CounterDocSchema.parse(write.data);

    // Resetting this would re-issue order numbers customers already have, and they are
    // what a customer quotes on WhatsApp.
    expect(write.mode).toBe('createIfAbsent');
    // `HumanOrderIdSchema` needs at least four digits, and starting at 1 would tell the
    // first customer they are the first customer.
    expect(counter.value).toBeGreaterThanOrEqual(1_000);
  });
});

describe('categories', () => {
  it('seeds every configured category, keyed by slug', () => {
    const writes = writesFor(rompPlan, 'categories');

    expect(writes).toHaveLength(romp.content.categories.length);
    expect(writes.map((write) => write.path)).toContain(paths.category('wooden'));
  });

  it('records the parent as a slug for a nested category', () => {
    const sensory = CategoryDocSchema.parse(writeAt(rompPlan, paths.category('sensory')).data);

    expect(sensory.parentId).toBe('wooden');
  });

  it('leaves a top-level category with no parent', () => {
    const wooden = CategoryDocSchema.parse(writeAt(rompPlan, paths.category('wooden')).data);

    expect(wooden.parentId).toBeNull();
  });

  it('rolls child counts up into the parent', () => {
    // ROMP seeds one product in `sensory` and one in `wooden` itself. Direct counts
    // only would show "Wooden toys (1)" while the tree holds two, which reads as a bug.
    const wooden = CategoryDocSchema.parse(writeAt(rompPlan, paths.category('wooden')).data);
    const sensory = CategoryDocSchema.parse(writeAt(rompPlan, paths.category('sensory')).data);

    expect(sensory.productCount).toBe(1);
    expect(wooden.productCount).toBe(sensory.productCount + 1);
  });

  it('counts only active products', () => {
    // `pretend-play` holds two seeded products, one of them a draft. A draft in a facet
    // count no listing can produce is worse than no count.
    const pretendPlay = CategoryDocSchema.parse(
      writeAt(rompPlan, paths.category('pretend-play')).data,
    );
    const seededHere = (rompCatalogue?.products ?? []).filter(
      (product) => product.category === 'pretend-play',
    );

    expect(seededHere.length).toBe(2);
    expect(pretendPlay.productCount).toBe(1);
  });

  it('seeds a zero count for a category with no products', () => {
    const outdoor = CategoryDocSchema.parse(
      writeAt(templatePlan, paths.category('category-two')).data,
    );

    expect(outdoor.productCount).toBe(0);
  });

  it('still seeds categories when there is no catalogue', () => {
    // A store importing products from elsewhere should not have to invent one to get
    // its taxonomy.
    const plan = planFor('romp', romp, null);

    expect(writesFor(plan, 'categories')).toHaveLength(romp.content.categories.length);
    expect(writesFor(plan, 'products')).toHaveLength(0);
    for (const write of writesFor(plan, 'categories')) {
      expect(CategoryDocSchema.parse(write.data).productCount).toBe(0);
    }
  });
});

describe('products', () => {
  const stackingRings = () =>
    ProductDocSchema.parse(writeAt(rompPlan, paths.product('beechwood-stacking-rings')).data);

  it('keys the product by its slug', () => {
    expect(stackingRings().slug).toBe('beechwood-stacking-rings');
  });

  it('takes the listing price from the cheapest sellable variant', () => {
    const product = stackingRings();
    const cheapest = Math.min(
      ...(rompCatalogue?.products
        .find((candidate) => candidate.slug === 'beechwood-stacking-rings')
        ?.variants.map((variant) => variant.priceMinor) ?? []),
    );

    expect(product.priceFromMinor).toBe(cheapest);
  });

  it('takes the MRP from the same variant as the price', () => {
    // From a different variant, the strike-through discount is computed across two
    // products' worth of pricing and can come out negative.
    const product = stackingRings();
    const source = rompCatalogue?.products.find(
      (candidate) => candidate.slug === 'beechwood-stacking-rings',
    );
    const cheapest = source?.variants.reduce((best, variant) =>
      variant.priceMinor < best.priceMinor ? variant : best,
    );

    expect(product.mrpFromMinor).toBe(cheapest?.mrpMinor);
  });

  it('summarises every variant for first paint', () => {
    const product = stackingRings();

    expect(product.variantSummary).toHaveLength(2);
    expect(product.variantSummary.map((variant) => variant.sku)).toEqual([
      'KDU-STK-NAT',
      'KDU-STK-DYE',
    ]);
  });

  it('summarises stock as a boolean, never as a count', () => {
    // Exact stock is commercially sensitive and rules keep `inventory` staff-only. A
    // count denormalised onto a public document would hand it straight back.
    const product = stackingRings();

    for (const variant of product.variantSummary) {
      expect(typeof variant.inStock).toBe('boolean');
    }
    expect(product.variantSummary.every((variant) => variant.inStock)).toBe(true);
  });

  it('marks a variant with no stock anywhere as out of stock', () => {
    const balanceBoard = ProductDocSchema.parse(
      writeAt(rompPlan, paths.product('balance-board-outdoor')).data,
    );
    const charcoal = balanceBoard.variantSummary.find((variant) => variant.sku === 'CHO-BAL-CHR');

    expect(charcoal?.inStock).toBe(false);
  });

  it('seeds no ratings, rather than inventing social proof', () => {
    const product = stackingRings();

    expect(product.ratingCount).toBe(0);
    expect(product.ratingAvg).toBe(0);
  });

  it('builds search tokens from the name, brand, category and age band', () => {
    const product = stackingRings();

    expect(product.searchTokens).toContain('beech');
    expect(product.searchTokens).toContain('kaadu');
    // The description is deliberately excluded — prefix-expanding 5 000 characters
    // makes every product a match for almost anything.
    expect(product.searchTokens).not.toContain('linseed');
  });

  it('publishes an active product and indexes it', () => {
    const product = stackingRings();

    expect(product.status).toBe('active');
    expect(product.publishedAt?.toISOString()).toBe(now.toISOString());
    expect(product.seo.index).toBe(true);
  });

  it('leaves a draft unpublished and unindexed', () => {
    // De-indexing after the fact is slow and partly out of our hands.
    const draft = ProductDocSchema.parse(
      writeAt(rompPlan, paths.product('shadow-theatre-kit')).data,
    );

    expect(draft.status).toBe('draft');
    expect(draft.publishedAt).toBeNull();
    expect(draft.seo.index).toBe(false);
  });

  it('converts an ISO certificate expiry to UTC midnight', () => {
    // Parsed as UTC so the stored value does not depend on the machine running the seed.
    const product = stackingRings();

    expect(product.safety.bisCertExpiry?.toISOString()).toBe('2029-04-30T00:00:00.000Z');
  });

  it('leaves an uncertified product with no certificate fields', () => {
    const jigsaw = ProductDocSchema.parse(
      writeAt(rompPlan, paths.product('city-map-jigsaw-500')).data,
    );

    expect(jigsaw.safety.bisCertified).toBe(false);
    expect(jigsaw.safety.bisCertNo).toBeNull();
    expect(jigsaw.safety.bisCertExpiry).toBeNull();
  });

  it('seeds no media, because photography comes from the admin pipeline', () => {
    expect(stackingRings().media).toEqual([]);
  });

  it('still derives a price for a draft whose every variant is inactive', () => {
    // Nothing is sellable, so the "cheapest sellable variant" rule has no candidates.
    // Admin still has to render a price, and falling back to the full set is the only
    // answer that is not zero — a product listed at ₹0 in admin invites a mis-priced
    // publish.
    const source = rompCatalogue?.products.find((product) => product.slug === 'shadow-theatre-kit');
    if (source === undefined) throw new Error('the draft product is missing from the catalogue');

    const allInactive: CatalogueSeed = {
      products: [
        {
          ...source,
          status: 'draft',
          variants: source.variants.map((variant) => ({ ...variant, active: false })),
        },
      ],
    };

    const plan = planFor('romp', romp, allInactive);
    const product = ProductDocSchema.parse(writeAt(plan, paths.product('shadow-theatre-kit')).data);
    const cheapest = Math.min(...source.variants.map((variant) => variant.priceMinor));

    expect(product.priceFromMinor).toBe(cheapest);
    expect(product.variantSummary.every((variant) => !variant.active)).toBe(true);
  });
});

describe('variants', () => {
  it('keys the variant by SKU, under its product', () => {
    const write = writeAt(rompPlan, paths.variant('beechwood-stacking-rings', 'KDU-STK-NAT'));
    const variant = VariantDocSchema.parse(write.data);

    expect(variant.sku).toBe('KDU-STK-NAT');
    // Carried so a collection-group query over variants does not have to parse the path.
    expect(variant.productId).toBe('beechwood-stacking-rings');
  });

  it('seeds one variant document per catalogue variant', () => {
    const expected = (rompCatalogue?.products ?? []).reduce(
      (total, product) => total + product.variants.length,
      0,
    );

    expect(writesFor(rompPlan, 'variants')).toHaveLength(expected);
  });

  it('carries the selection options through', () => {
    const variant = VariantDocSchema.parse(
      writeAt(rompPlan, paths.variant('beechwood-stacking-rings', 'KDU-STK-NAT')).data,
    );

    expect(variant.options).toEqual({ finish: 'natural' });
  });
});

describe('inventory', () => {
  it('keys the inventory record by variant ID', () => {
    // One document per variant, so a checkout transaction touches exactly one per line.
    expect(writeAt(rompPlan, paths.inventory('KDU-STK-NAT'))).toBeDefined();
  });

  it('sums per-warehouse stock into the denormalised total', () => {
    const inventory = InventoryDocSchema.parse(
      writeAt(rompPlan, paths.inventory('KDU-STK-NAT')).data,
    );

    expect(inventory.stock).toEqual({ blr: 24, del: 16 });
    expect(inventory.onHandTotal).toBe(40);
  });

  it('reserves nothing on a fresh store', () => {
    const inventory = InventoryDocSchema.parse(
      writeAt(rompPlan, paths.inventory('KDU-STK-NAT')).data,
    );

    expect(inventory.reserved).toBe(0);
  });

  it('drops zero-stock warehouses from the map', () => {
    // `{ blr: 9, del: 0 }` in the catalogue. Storing the zero would make "which
    // warehouses hold this" a question about values rather than about keys.
    const inventory = InventoryDocSchema.parse(
      writeAt(rompPlan, paths.inventory('CHO-BAL-NAT')).data,
    );

    expect(inventory.stock).toEqual({ blr: 9 });
    expect(inventory.onHandTotal).toBe(9);
  });

  it('seeds an empty map and a zero total for a variant with no stock', () => {
    const inventory = InventoryDocSchema.parse(
      writeAt(rompPlan, paths.inventory('CHO-BAL-CHR')).data,
    );

    expect(inventory.stock).toEqual({});
    expect(inventory.onHandTotal).toBe(0);
  });

  it('takes the low-stock threshold from store config', () => {
    const inventory = InventoryDocSchema.parse(
      writeAt(rompPlan, paths.inventory('KDU-STK-NAT')).data,
    );

    expect(inventory.lowStockThreshold).toBe(romp.commerce.lowStockThreshold);
  });
});

describe('the opening-balance ledger', () => {
  it('writes one entry per warehouse holding stock', () => {
    const entries = writesFor(rompPlan, 'inventoryLedger').filter((write) =>
      write.path.includes('KDU-STK-NAT'),
    );

    expect(entries).toHaveLength(2);
  });

  it('writes no entry for a warehouse with no stock', () => {
    const entries = writesFor(rompPlan, 'inventoryLedger').filter((write) =>
      write.path.includes('CHO-BAL-CHR'),
    );

    expect(entries).toHaveLength(0);
  });

  it('reconciles to the inventory balance for every variant', () => {
    // The ledger is the source of truth for movement and `inventory.stock` is a
    // materialised balance. If the seed can produce a pair that disagree, the
    // reconciliation runbook has nothing to stand on.
    const byVariant = new Map<string, number>();

    for (const write of writesFor(rompPlan, 'inventoryLedger')) {
      const entry = InventoryLedgerDocSchema.parse(write.data);
      byVariant.set(entry.variantId, (byVariant.get(entry.variantId) ?? 0) + entry.delta);
    }

    for (const write of writesFor(rompPlan, 'inventory')) {
      const inventory = InventoryDocSchema.parse(write.data);
      const variantId = write.path.split('/').at(-1) ?? '';

      expect(byVariant.get(variantId) ?? 0).toBe(inventory.onHandTotal);
    }
  });

  it('derives a deterministic entry ID from the SKU and warehouse', () => {
    // So a re-run overwrites the same entry rather than appending a second opening
    // balance.
    expect(writeAt(rompPlan, paths.ledgerEntry('seed_KDU-STK-NAT_blr'))).toBeDefined();
  });

  it('attributes the opening balance to the system, naming the source file', () => {
    const entry = InventoryLedgerDocSchema.parse(
      writeAt(rompPlan, paths.ledgerEntry('seed_KDU-STK-NAT_blr')).data,
    );

    expect(entry.reason).toBe('seed');
    expect(entry.actorId).toBe('system');
    expect(entry.refId).toBeNull();
    expect(entry.note).toContain('stores/romp/seed.catalogue.ts');
  });
});

describe('the scaffold store', () => {
  it('seeds a complete, valid store from the template alone', () => {
    // `pnpm store:new` followed by `pnpm seed` has to work, or a new store's first
    // experience is a failure.
    expect(templatePlan.writes.length).toBeGreaterThan(0);
    expect(writesFor(templatePlan, 'products')).toHaveLength(2);
    expect(writesFor(templatePlan, 'variants')).toHaveLength(3);
  });

  it('uses the template warehouse code, not ROMP’s', () => {
    const entries = writesFor(templatePlan, 'inventoryLedger').map((write) =>
      InventoryLedgerDocSchema.parse(write.data),
    );

    expect(entries.every((entry) => entry.warehouseId === 'main')).toBe(true);
  });
});
