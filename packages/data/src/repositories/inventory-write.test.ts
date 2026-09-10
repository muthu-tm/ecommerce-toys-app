import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { anInventoryRecord } from '@romp/contracts/fixtures';

import { fixedClock } from '../clock';
import { ANONYMOUS, asOperator, asSystem, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import { StockAdjustmentError, adjustInventory } from './inventory-write';

/**
 * Unit tests for the inventory adjustment transaction.
 *
 * The arithmetic and its refusals are `@romp/core`'s and tested there; this asserts the
 * transactional behaviour a real database shows: that a successful adjustment writes both the
 * balance and a ledger entry, that a refusal throws before writing anything, that a first
 * adjustment creates the record, and that only staff may adjust. End-to-end against real
 * Firestore is in `infra/tests`.
 */

const NOW = new Date('2026-03-01T09:30:00.000Z');
const STAFF = asOperator('staff-1', 'staff');
const SYSTEM = asSystem('reconcile');

interface Seed {
  readonly path: string;
  readonly data: Record<string, unknown>;
}

/** A transaction-capable Firestore double honouring converters, records writes by path. */
function fakeDb(seed: readonly Seed[] = []) {
  const store = new Map<string, Record<string, unknown>>(seed.map((s) => [s.path, s.data]));
  const writes: { path: string; data: Record<string, unknown> }[] = [];
  let generated = 0;

  interface Converter {
    toFirestore: (v: unknown) => Record<string, unknown>;
    fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
  }

  const docRef = (path: string) => {
    let converter: Converter | null = null;
    const ref = {
      path,
      id: path.split('/').at(-1) ?? '',
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      get converter() {
        return converter;
      },
    };
    return ref;
  };

  const collectionRef = (path: string) => ({
    doc: () => {
      generated += 1;
      return docRef(`${path}/generated-${String(generated)}`);
    },
  });

  type DocRef = ReturnType<typeof docRef>;

  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: DocRef) => Promise<{ data: () => unknown }>;
      set: (ref: DocRef, data: unknown) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    const staged: { path: string; data: Record<string, unknown> }[] = [];
    const tx = {
      get: (ref: DocRef) => {
        const raw = store.get(ref.path);
        return Promise.resolve({
          data: () =>
            raw === undefined
              ? undefined
              : ref.converter === null
                ? raw
                : ref.converter.fromFirestore({ id: ref.id, data: () => raw }),
        });
      },
      set: (ref: DocRef, data: unknown) => {
        const encoded = ref.converter === null ? data : ref.converter.toFirestore(data);
        staged.push({ path: ref.path, data: encoded as Record<string, unknown> });
      },
    };
    const result = await fn(tx);
    for (const w of staged) {
      store.set(w.path, w.data);
      writes.push(w);
    }
    return result;
  };

  const db = { doc: docRef, collection: collectionRef, runTransaction } as unknown as Firestore;
  return { db, store, writes };
}

function ctxWith(db: Firestore): StoreContext {
  return createStoreContext({ storeId: 'test-store', db, clock: fixedClock(NOW) });
}

/** An inventory record at the given path, encoded through the converter. */
function storedInventory(variantId: string, overrides = {}): Seed {
  return {
    path: `inventory/${variantId}`,
    data: converters.inventory.toFirestore(anInventoryRecord(overrides)),
  };
}

const baseAdjustment = {
  variantId: 'v1',
  productId: 'wooden-blocks',
  warehouseId: 'blr',
  reason: 'adjustment' as const,
  note: 'Physical count correction',
  refId: null,
  lowStockThreshold: 5,
};

describe('adjustInventory', () => {
  it('applies a positive delta and writes both the balance and a ledger entry', async () => {
    // anInventoryRecord() has stock {blr: 20}, reserved 0.
    const { db, store, writes } = fakeDb([storedInventory('v1')]);

    const result = await adjustInventory(ctxWith(db), STAFF, { ...baseAdjustment, delta: 10 });

    // Default record is { blr: 12, del: 8 } = 20 on hand; +10 to blr -> blr 22, total 30.
    expect(result.onHandTotal).toBe(30);
    const inventory = store.get('inventory/v1');
    expect((inventory?.stock as Record<string, number>).blr).toBe(22);
    // A ledger entry was appended alongside the balance write.
    expect(writes.some((w) => w.path.startsWith('inventoryLedger/'))).toBe(true);
    expect(result.ledgerEntryId).toContain('generated-');
  });

  it('creates the inventory record on a first adjustment when none exists', async () => {
    const { db, store } = fakeDb();

    const result = await adjustInventory(ctxWith(db), STAFF, {
      ...baseAdjustment,
      variantId: 'fresh',
      delta: 8,
    });

    expect(result.onHandTotal).toBe(8);
    expect(store.get('inventory/fresh')?.lowStockThreshold).toBe(5);
  });

  it('records the acting operator on the ledger entry', async () => {
    const { db, store } = fakeDb([storedInventory('v1')]);

    await adjustInventory(ctxWith(db), STAFF, { ...baseAdjustment, delta: 1 });

    const ledger = [...store.entries()].find(([path]) => path.startsWith('inventoryLedger/'));
    expect(ledger?.[1].actorId).toBe('staff-1');
  });

  it('attributes a system caller as "system" on the ledger', async () => {
    const { db, store } = fakeDb([storedInventory('v1')]);

    await adjustInventory(ctxWith(db), SYSTEM, {
      ...baseAdjustment,
      reason: 'reconciliation',
      delta: 2,
    });

    const ledger = [...store.entries()].find(([path]) => path.startsWith('inventoryLedger/'));
    expect(ledger?.[1].actorId).toBe('system');
  });

  it('refuses an adjustment that would take a warehouse negative, writing nothing', async () => {
    const { db, writes } = fakeDb([storedInventory('v1')]);

    await expect(
      adjustInventory(ctxWith(db), STAFF, { ...baseAdjustment, delta: -25 }),
    ).rejects.toBeInstanceOf(StockAdjustmentError);
    expect(writes).toHaveLength(0);
  });

  it('refuses an oversell adjustment (below reserved), writing nothing', async () => {
    // 20 on hand, 15 reserved; removing 10 would leave 10 for 15 reserved.
    const { db, writes } = fakeDb([storedInventory('v1', { reserved: 15 })]);

    const error = await adjustInventory(ctxWith(db), STAFF, {
      ...baseAdjustment,
      delta: -10,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StockAdjustmentError);
    expect((error as StockAdjustmentError).reason).toBe('oversell');
    expect(writes).toHaveLength(0);
  });

  it('refuses a non-staff caller', async () => {
    const { db } = fakeDb([storedInventory('v1')]);

    await expect(
      adjustInventory(ctxWith(db), ANONYMOUS, { ...baseAdjustment, delta: 1 }),
    ).rejects.toThrow();
  });
});
