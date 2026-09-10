import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CHECKOUT_SETTINGS_ID } from '@romp/contracts';
import { COLLECTIONS, converters, fixedClock, paths } from '@romp/data';
import { applySeedPlan, buildSeedPlan } from '@romp/data/seed';
import { loadCatalogueSeed, loadStoreConfig } from '@romp/store-config/loader';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The seed, against a real Firestore.
 *
 * `@romp/data`'s own tests cover the builders (pure) and the writer (against an
 * in-memory double). This suite covers the two things neither can: that the Admin SDK
 * usage is correct, and that the seed is genuinely **idempotent** when the second run
 * is reading back what the first one actually stored rather than what a fake said it
 * stored.
 *
 * The idempotency assertion is the reason this file exists. A seed that duplicates on
 * re-run is not discovered by a unit test — it is discovered when someone runs
 * `pnpm seed` twice on a dev project and the catalogue doubles.
 */

let app: App;
let db: Firestore;

const clock = fixedClock(new Date('2026-03-01T09:30:00.000Z'));
const laterClock = fixedClock(new Date('2026-03-02T09:30:00.000Z'));

const romp = await loadStoreConfig('romp');
const catalogue = await loadCatalogueSeed('romp', romp);

const planWith = (at: typeof clock) =>
  buildSeedPlan({ storeId: 'romp', config: romp, catalogue, clock: at });

/** Counts documents in a collection, ignoring subcollections. */
async function countIn(collection: string): Promise<number> {
  const snapshot = await db.collection(collection).count().get();
  return snapshot.data().count;
}

/** Every seed-owned collection, cleared between tests so each run starts empty. */
const SEED_OWNED = [
  COLLECTIONS.products,
  COLLECTIONS.categories,
  COLLECTIONS.warehouses,
  COLLECTIONS.inventory,
  COLLECTIONS.inventoryLedger,
  COLLECTIONS.settings,
  COLLECTIONS.counters,
] as const;

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `seed-suite-${String(Date.now())}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  for (const collection of SEED_OWNED) {
    await db.recursiveDelete(db.collection(collection));
  }
});

describe('a first seed run', () => {
  it('writes every document in the plan', async () => {
    const plan = planWith(clock);
    const result = await applySeedPlan(db, plan);

    expect(result.updated + result.created).toBe(plan.writes.length);
    expect(result.skipped).toBe(0);
  });

  it('produces a browsable catalogue', async () => {
    // The task's acceptance criterion, asserted rather than assumed: an active product
    // with a readable price, a variant, stock, and a category that counts it.
    await applySeedPlan(db, planWith(clock));

    const products = await db
      .collection(COLLECTIONS.products)
      .withConverter(converters.products)
      .where('status', '==', 'active')
      .get();

    expect(products.size).toBeGreaterThan(0);

    for (const document of products.docs) {
      const product = document.data();
      expect(product.priceFromMinor).toBeGreaterThan(0);
      expect(product.variantSummary.length).toBeGreaterThan(0);
      expect(product.searchTokens.length).toBeGreaterThan(0);
      // Read through the converter, so every one of these documents also just passed
      // its full schema including every cross-field refinement.
      expect(product.createdAt).toBeInstanceOf(Date);
    }
  });

  it('round-trips timestamps as Dates, not Timestamps', async () => {
    await applySeedPlan(db, planWith(clock));

    const snapshot = await db
      .doc(paths.warehouse('blr'))
      .withConverter(converters.warehouses)
      .get();
    const warehouse = snapshot.data();

    expect(warehouse?.createdAt).toBeInstanceOf(Date);
    expect(warehouse?.createdAt.toISOString()).toBe('2026-03-01T09:30:00.000Z');
  });

  it('writes a variant under its product, reachable by SKU', async () => {
    await applySeedPlan(db, planWith(clock));

    const snapshot = await db
      .doc(paths.variant('beechwood-stacking-rings', 'KDU-STK-NAT'))
      .withConverter(converters.variants)
      .get();

    expect(snapshot.exists).toBe(true);
    expect(snapshot.data()?.sku).toBe('KDU-STK-NAT');
  });

  it('writes inventory whose total matches its ledger entries', async () => {
    // The reconciliation invariant, checked against what is actually stored rather than
    // against the plan.
    await applySeedPlan(db, planWith(clock));

    const inventory = await db
      .doc(paths.inventory('KDU-STK-NAT'))
      .withConverter(converters.inventory)
      .get();
    const entries = await db
      .collection(COLLECTIONS.inventoryLedger)
      .withConverter(converters.inventoryLedger)
      .where('variantId', '==', 'KDU-STK-NAT')
      .get();

    const ledgerTotal = entries.docs.reduce((total, document) => total + document.data().delta, 0);

    expect(inventory.data()?.onHandTotal).toBe(ledgerTotal);
  });

  it('leaves a draft product out of the public query', async () => {
    await applySeedPlan(db, planWith(clock));

    const active = await db.collection(COLLECTIONS.products).where('status', '==', 'active').get();
    const slugs = active.docs.map((document) => document.id);

    expect(slugs).not.toContain('shadow-theatre-kit');
    expect((await db.doc(paths.product('shadow-theatre-kit')).get()).exists).toBe(true);
  });

  it('initialises checkout settings and the order counter', async () => {
    await applySeedPlan(db, planWith(clock));

    const settings = await db
      .doc(paths.checkoutSettings())
      .withConverter(converters.checkoutSettings)
      .get();
    const counter = await db
      .doc(paths.orderHumanIdCounter())
      .withConverter(converters.counters)
      .get();

    expect(settings.id).toBe(CHECKOUT_SETTINGS_ID);
    expect(settings.data()?.gstRateBasisPoints).toBe(romp.locale.gstRateBasisPoints);
    expect(counter.data()?.value).toBeGreaterThanOrEqual(1_000);
  });
});

describe('re-running the seed', () => {
  it('does not duplicate anything', async () => {
    // The assertion this file exists for. Natural-key document IDs are what make a
    // second run an update; auto-IDs would double the catalogue.
    const plan = planWith(clock);
    await applySeedPlan(db, plan);

    const before = await Promise.all(SEED_OWNED.map(countIn));
    await applySeedPlan(db, plan);
    const after = await Promise.all(SEED_OWNED.map(countIn));

    expect(after).toEqual(before);
  });

  it('leaves identical documents byte-for-byte identical', async () => {
    const plan = planWith(clock);
    await applySeedPlan(db, plan);
    const first = (await db.doc(paths.product('beechwood-stacking-rings')).get()).data();

    await applySeedPlan(db, plan);
    const second = (await db.doc(paths.product('beechwood-stacking-rings')).get()).data();

    expect(second).toEqual(first);
  });

  it('skips settings and the counter rather than reverting them', async () => {
    // A seed run must not undo a fee change an operator made in admin, and must never
    // reset the order-number sequence — customers already hold those numbers.
    await applySeedPlan(db, planWith(clock));

    await db.doc(paths.checkoutSettings()).update({ giftWrapFeeMinor: 1 });
    await db.doc(paths.orderHumanIdCounter()).update({ value: 5_000 });

    const result = await applySeedPlan(db, planWith(laterClock));

    expect(result.skipped).toBe(2);
    expect((await db.doc(paths.checkoutSettings()).get()).data()?.giftWrapFeeMinor).toBe(1);
    expect((await db.doc(paths.orderHumanIdCounter()).get()).data()?.value).toBe(5_000);
  });

  it('updates a product when the catalogue changes', async () => {
    await applySeedPlan(db, planWith(clock));

    const edited = await applySeedPlan(db, {
      storeId: 'romp',
      writes: planWith(clock).writes.map((write) =>
        write.path === paths.product('beechwood-stacking-rings')
          ? { ...write, data: { ...(write.data as object), name: 'Renamed in the file' } }
          : write,
      ),
    });

    expect(edited.skipped).toBe(2);
    expect((await db.doc(paths.product('beechwood-stacking-rings')).get()).data()?.name).toBe(
      'Renamed in the file',
    );
  });

  it('removes a field that was deleted from the catalogue', async () => {
    // `set` without merge, so the file is the truth for everything the seed owns. A
    // merge would leave a removed badge lingering on the product page forever.
    await applySeedPlan(db, planWith(clock));
    expect((await db.doc(paths.product('beechwood-stacking-rings')).get()).data()?.badge).toBe(
      'Bestseller',
    );

    await applySeedPlan(db, {
      storeId: 'romp',
      writes: planWith(clock).writes.map((write) =>
        write.path === paths.product('beechwood-stacking-rings')
          ? { ...write, data: { ...(write.data as object), badge: null } }
          : write,
      ),
    });

    expect(
      (await db.doc(paths.product('beechwood-stacking-rings')).get()).data()?.badge,
    ).toBeNull();
  });
});

describe('the live-reservation guard', () => {
  it('refuses to run when an inventory document is holding stock', async () => {
    // Writing `reserved: 0` under a live order would release units without releasing
    // the order holding them.
    await applySeedPlan(db, planWith(clock));
    await db.doc(paths.inventory('KDU-STK-NAT')).update({ reserved: 3 });

    await expect(applySeedPlan(db, planWith(laterClock))).rejects.toThrow(/Refusing to seed/);
  });

  it('writes nothing at all when it refuses', async () => {
    await applySeedPlan(db, planWith(clock));
    await db.doc(paths.inventory('KDU-STK-NAT')).update({ reserved: 3 });

    const before = (await db.doc(paths.warehouse('blr')).get()).data();
    await expect(applySeedPlan(db, planWith(laterClock))).rejects.toThrow();
    const after = (await db.doc(paths.warehouse('blr')).get()).data();

    // A half-seeded catalogue is worse than no change.
    expect(after).toEqual(before);
  });
});

describe('the second store', () => {
  it('seeds the scaffold configuration into the same database shape', async () => {
    // `_template` has one warehouse instead of two and a different taxonomy, so a seed
    // that had quietly assumed ROMP's shape fails here.
    const template = await loadStoreConfig('_template', { allowScaffold: true });
    const templateCatalogue = await loadCatalogueSeed('_template', template);

    const result = await applySeedPlan(
      db,
      buildSeedPlan({
        storeId: '_template',
        config: template,
        catalogue: templateCatalogue,
        clock,
      }),
    );

    expect(result.updated).toBeGreaterThan(0);
    expect(await countIn(COLLECTIONS.warehouses)).toBe(1);
  });
});
