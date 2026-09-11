import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { OrderDoc } from '@romp/contracts';
import { anInventoryRecord, anOrder } from '@romp/contracts/fixtures';
import { NotFoundError, RefundExceedsRefundableError } from '@romp/observability';

import { fixedClock } from '../clock';
import { asOperator, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import { issueRefund } from './refund-write';

/**
 * Unit tests for refunds.
 *
 * The concern is the orchestration: a refund is append-only, raises the order's running
 * `refundedMinor` (capped at the total), moves the order to `refunded` only when the whole total is
 * returned, optionally restocks the allocated warehouses, and is owner-gated. The end-to-end stock
 * movement is proven against the emulator.
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ORDER_ID = 'order-1';
const VARIANT = 'WB-240';
const OWNER = asOperator('owner-uid-0001', 'owner');
const STAFF = asOperator('staff-uid-0001', 'staff');
const TOTAL = 2_90_976; // anOrder() default total

interface StoredDoc {
  readonly path: string;
  data: Record<string, unknown>;
}

interface Converter {
  toFirestore: (v: unknown) => Record<string, unknown>;
  fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
}

/** A Firestore double: doc get; transaction with get/set and collection auto-id doc(). */
function fakeDb(seed: readonly StoredDoc[] = []) {
  const store = new Map<string, Record<string, unknown>>(seed.map((d) => [d.path, d.data]));
  let generated = 0;

  const decode = (
    path: string,
    raw: Record<string, unknown> | undefined,
    converter: Converter | null,
  ) =>
    raw === undefined || converter === null
      ? raw
      : (converter.fromFirestore({ id: path.split('/').at(-1) ?? '', data: () => raw }) as Record<
          string,
          unknown
        >);

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

  const collectionRef = (path: string) => {
    let converter: Converter | null = null;
    const ref = {
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      doc: () => {
        generated += 1;
        const d = docRef(`${path}/generated-${String(generated)}`);
        return converter === null ? d : d.withConverter(converter);
      },
    };
    return ref;
  };

  type DocRef = ReturnType<typeof docRef>;

  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: DocRef) => Promise<{ data: () => unknown }>;
      set: (ref: DocRef, data: unknown) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    const staged: { path: string; data: Record<string, unknown> }[] = [];
    const tx = {
      get: (ref: DocRef) =>
        Promise.resolve({ data: () => decode(ref.path, store.get(ref.path), ref.converter) }),
      set: (ref: DocRef, data: unknown) => {
        staged.push({
          path: ref.path,
          data: (ref.converter === null ? data : ref.converter.toFirestore(data)) as Record<
            string,
            unknown
          >,
        });
      },
    };
    const result = await fn(tx);
    for (const w of staged) store.set(w.path, w.data);
    return result;
  };

  const db = { doc: docRef, collection: collectionRef, runTransaction } as unknown as Firestore;
  return { db, store };
}

function ctxWith(db: Firestore): StoreContext {
  return createStoreContext({ storeId: 'test-store', db, clock: fixedClock(NOW) });
}

/** Seeds a paid order (with a given already-refunded amount) and its inventory. */
function seed(
  overrides: { refundedMinor?: number; status?: OrderDoc['status'] } = {},
): StoredDoc[] {
  const order = anOrder({
    status: overrides.status ?? 'paid',
    reservationId: null,
    allocation: { [VARIANT]: { blr: 2 } } as unknown as OrderDoc['allocation'],
    payment: {
      ...anOrder().payment,
      upiRef: '412398765432' as OrderDoc['payment']['upiRef'],
      submittedAt: NOW,
      verifiedBy: 'staff-uid-0001' as OrderDoc['payment']['verifiedBy'],
      verifiedAt: NOW,
    },
    amounts: {
      ...anOrder().amounts,
      refundedMinor: (overrides.refundedMinor ?? 0) as OrderDoc['amounts']['refundedMinor'],
    },
  });
  const inventory = anInventoryRecord({
    stock: { blr: 8 } as ReturnType<typeof anInventoryRecord>['stock'],
    onHandTotal: 8,
    reserved: 0,
  });
  return [
    { path: `orders/${ORDER_ID}`, data: converters.orders.toFirestore(order) },
    { path: `inventory/${VARIANT}`, data: converters.inventory.toFirestore(inventory) },
  ];
}

const fullRefund = {
  orderId: ORDER_ID,
  mode: 'full' as const,
  amountMinor: TOTAL,
  reason: 'customer_cancelled' as const,
  note: null,
  outwardUpiRef: null,
  restock: false,
};

describe('issueRefund', () => {
  it('records a full refund and moves the order to refunded', async () => {
    const { db, store } = fakeDb(seed());
    const result = await issueRefund(ctxWith(db), OWNER, fullRefund);

    expect(result.status).toBe('refunded');
    expect(result.refundedMinor).toBe(TOTAL);
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('refunded');
    expect(
      (store.get(`orders/${ORDER_ID}`)?.amounts as { refundedMinor: number }).refundedMinor,
    ).toBe(TOTAL);
    // The refund record was written with the order's userId denormalised.
    const refund = [...store.entries()].find(([key]) => key.startsWith('refunds/'));
    expect(refund).toBeDefined();
    expect(refund?.[1].createdBy).toBe('owner-uid-0001');
  });

  it('records a partial refund and leaves the order paid', async () => {
    const { db, store } = fakeDb(seed());
    const result = await issueRefund(ctxWith(db), OWNER, {
      ...fullRefund,
      mode: 'partial',
      amountMinor: 1_00_000,
    });
    expect(result.status).toBe('paid');
    expect(result.refundedMinor).toBe(1_00_000);
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('paid');
  });

  it('composes partial refunds up to the total, then refunds the order', async () => {
    const { db } = fakeDb(seed({ refundedMinor: TOTAL - 1_00_000 }));
    const result = await issueRefund(ctxWith(db), OWNER, {
      ...fullRefund,
      mode: 'partial',
      amountMinor: 1_00_000,
    });
    expect(result.refundedMinor).toBe(TOTAL);
    expect(result.status).toBe('refunded');
  });

  it('refuses a refund that would exceed the refundable amount', async () => {
    const { db, store } = fakeDb(seed({ refundedMinor: TOTAL - 1_00_000 }));
    await expect(
      issueRefund(ctxWith(db), OWNER, { ...fullRefund, amountMinor: 1_50_000 }),
    ).rejects.toBeInstanceOf(RefundExceedsRefundableError);
    // Nothing moved.
    expect(
      (store.get(`orders/${ORDER_ID}`)?.amounts as { refundedMinor: number }).refundedMinor,
    ).toBe(TOTAL - 1_00_000);
  });

  it('restocks the allocated warehouse when asked', async () => {
    const { db, store } = fakeDb(seed());
    await issueRefund(ctxWith(db), OWNER, { ...fullRefund, restock: true });
    // On-hand rose by the allocated 2 (8 -> 10).
    expect(store.get(`inventory/${VARIANT}`)?.onHandTotal).toBe(10);
    const ledger = [...store.entries()].find(([key]) => key.startsWith('inventoryLedger/'));
    expect(ledger?.[1].reason).toBe('refund_restock');
    expect(ledger?.[1].delta).toBe(2);
  });

  it('skips restock silently when the inventory record is gone', async () => {
    const seeded = seed().filter((d) => !d.path.startsWith('inventory/'));
    const { db, store } = fakeDb(seeded);
    const result = await issueRefund(ctxWith(db), OWNER, { ...fullRefund, restock: true });
    // The refund still succeeds; there is just nothing to restock into.
    expect(result.status).toBe('refunded');
    const ledger = [...store.entries()].find(([key]) => key.startsWith('inventoryLedger/'));
    expect(ledger).toBeUndefined();
  });

  it('does not restock when not asked', async () => {
    const { db, store } = fakeDb(seed());
    await issueRefund(ctxWith(db), OWNER, { ...fullRefund, restock: false });
    expect(store.get(`inventory/${VARIANT}`)?.onHandTotal).toBe(8);
    const ledger = [...store.entries()].find(([key]) => key.startsWith('inventoryLedger/'));
    expect(ledger).toBeUndefined();
  });

  it('refuses a non-owner (staff) — owner claim required', async () => {
    const { db } = fakeDb(seed());
    await expect(issueRefund(ctxWith(db), STAFF, fullRefund)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to refund an order that is not paid', async () => {
    const { db } = fakeDb(seed({ status: 'pending_verification' }));
    await expect(issueRefund(ctxWith(db), OWNER, fullRefund)).rejects.toThrow();
  });

  it('404s a missing order', async () => {
    const { db } = fakeDb([]);
    await expect(issueRefund(ctxWith(db), OWNER, fullRefund)).rejects.toBeInstanceOf(NotFoundError);
  });
});
