import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { anInventoryRecord } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  StockAdjustmentError,
  adjustInventory,
  asOperator,
  asSystem,
  converters,
  createStoreContext,
  findInventory,
  listLedgerForVariant,
  reconcileVariantStock,
  systemClock,
} from '@romp/data';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The inventory write path against real Firestore.
 *
 * `@romp/core` unit-tests the arithmetic and `@romp/data` unit-tests the transaction shape;
 * this proves the two documents move together atomically — a successful adjustment leaves the
 * balance and the ledger in agreement (so `reconcileVariantStock` reports balanced), a first
 * adjustment creates the record, and a refused oversell leaves both untouched.
 */

let app: App;
let ctx: StoreContext;
const STAFF = asOperator('staff-1', 'staff');
const SYSTEM = asSystem('reconcile');

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `inventory-write-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

/** Seeds an inventory record directly, so an adjustment has a balance to move. */
async function seedInventory(variantId: string, overrides = {}): Promise<void> {
  await ctx.db
    .doc(`inventory/${variantId}`)
    .withConverter(converters.inventory)
    .set(anInventoryRecord(overrides));
}

const base = (variantId: string) => ({
  variantId,
  productId: 'wooden-blocks',
  warehouseId: 'blr',
  reason: 'adjustment' as const,
  note: 'Physical count',
  refId: null,
  lowStockThreshold: 5,
});

describe('adjustInventory', () => {
  it('moves the balance and appends a ledger entry that reconciles', async () => {
    const variantId = `inv-adjust-${String(Date.now())}`;
    await seedInventory(variantId);

    // A ledger entry for the seeded balance, so reconciliation has a baseline to sum against.
    await ctx.db
      .collection('inventoryLedger')
      .withConverter(converters.inventoryLedger)
      .add({
        variantId: variantId as never,
        productId: 'wooden-blocks' as never,
        warehouseId: 'blr' as never,
        delta: 12,
        reason: 'seed',
        actorId: 'system' as never,
        refId: null,
        note: null,
        at: new Date('2026-02-01T00:00:00.000Z'),
      });
    await ctx.db
      .collection('inventoryLedger')
      .withConverter(converters.inventoryLedger)
      .add({
        variantId: variantId as never,
        productId: 'wooden-blocks' as never,
        warehouseId: 'del' as never,
        delta: 8,
        reason: 'seed',
        actorId: 'system' as never,
        refId: null,
        note: null,
        at: new Date('2026-02-01T00:00:00.000Z'),
      });

    await adjustInventory(ctx, STAFF, { ...base(variantId), delta: 10 });

    const inventory = await findInventory(ctx, STAFF, variantId);
    expect(inventory?.onHandTotal).toBe(30);
    expect((inventory?.stock as Record<string, number> | undefined)?.blr).toBe(22);

    const ledger = await listLedgerForVariant(ctx, STAFF, variantId);
    expect(ledger.some((entry) => entry.delta === 10 && entry.reason === 'adjustment')).toBe(true);

    // Ledger deltas (12 + 8 seed + 10 adjust) reconcile with the stored balance (30).
    const reconciliation = await reconcileVariantStock(ctx, STAFF, variantId);
    expect(reconciliation.balanced).toBe(true);
  });

  it('creates the inventory record on a first adjustment', async () => {
    const variantId = `inv-fresh-${String(Date.now())}`;

    await adjustInventory(ctx, STAFF, { ...base(variantId), delta: 6 });

    const inventory = await findInventory(ctx, STAFF, variantId);
    expect(inventory?.onHandTotal).toBe(6);
    expect((inventory?.stock as Record<string, number> | undefined)?.blr).toBe(6);
  });

  it('refuses an oversell adjustment and leaves the balance untouched', async () => {
    const variantId = `inv-oversell-${String(Date.now())}`;
    await seedInventory(variantId, { reserved: 15 });

    await expect(
      adjustInventory(ctx, STAFF, { ...base(variantId), delta: -10 }),
    ).rejects.toBeInstanceOf(StockAdjustmentError);

    const inventory = await findInventory(ctx, STAFF, variantId);
    // Unchanged: still 20 on hand.
    expect(inventory?.onHandTotal).toBe(20);
  });

  it('attributes a system reconciliation to "system" on the ledger', async () => {
    const variantId = `inv-recon-${String(Date.now())}`;
    await seedInventory(variantId);

    await adjustInventory(ctx, SYSTEM, {
      ...base(variantId),
      reason: 'reconciliation',
      delta: 3,
    });

    const ledger = await listLedgerForVariant(ctx, SYSTEM, variantId);
    expect(ledger[0]?.actorId).toBe('system');
    expect(ledger[0]?.reason).toBe('reconciliation');
  });
});
