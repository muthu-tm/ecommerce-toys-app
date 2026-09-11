import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { OrderDoc, ReservationDoc } from '@romp/contracts';
import { anInventoryRecord, anOrder, aReservation } from '@romp/contracts/fixtures';

import { fixedClock } from '../clock';
import { createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import { releaseReservation, sweepExpiredReservations } from './reservation-write';

/**
 * Unit tests for the reservation sweeper.
 *
 * The concurrency and end-to-end integrity are proven against the emulator; here a stateful
 * Firestore double asserts the orchestration: releasing an expired reservation lowers `reserved`,
 * expires the order, marks the reservation released and writes the audit events — and, crucially,
 * that a re-run is a no-op and an order that has moved on (a customer submitted proof) is left alone.
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ORDER_ID = 'order-1';
const RES_ID = 'res-1';
const VARIANT = 'WB-240';

interface StoredDoc {
  readonly path: string;
  data: Record<string, unknown>;
}

interface Converter {
  toFirestore: (v: unknown) => Record<string, unknown>;
  fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
}

/**
 * A Firestore double supporting doc get; a collection query with two `where` clauses, `orderBy` and
 * `limit` (for `listExpiredReservations`); and a transaction with get/set and collection auto-id
 * `doc()` (for the spine event). Writes apply atomically after the callback resolves.
 */
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
      get: () =>
        Promise.resolve({
          id: ref.id,
          exists: store.get(path) !== undefined,
          data: () => decode(path, store.get(path), converter),
        }),
    };
    return ref;
  };

  interface Filter {
    field: string;
    op: string;
    value: unknown;
  }

  const collectionRef = (path: string) => {
    let converter: Converter | null = null;
    const filters: Filter[] = [];
    let orderField: string | null = null;
    let limitN = Infinity;
    const ref = {
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      where: (field: string, op: string, value: unknown) => {
        filters.push({ field, op, value });
        return ref;
      },
      orderBy: (field: string) => {
        orderField = field;
        return ref;
      },
      limit: (n: number) => {
        limitN = n;
        return ref;
      },
      doc: () => {
        generated += 1;
        const d = docRef(`${path}/generated-${String(generated)}`);
        return converter === null ? d : d.withConverter(converter);
      },
      get: () => {
        const prefix = `${path}/`;
        let rows = [...store.entries()]
          .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map(([key, raw]) => ({ key, decoded: decode(key, raw, converter)! }));
        for (const f of filters) {
          rows = rows.filter(({ decoded }) => {
            const v = decoded[f.field];
            if (f.op === '==') return v === f.value;
            if (f.op === '<=') return (v as Date).getTime() <= (f.value as Date).getTime();
            return true;
          });
        }
        if (orderField !== null) {
          const field = orderField;
          rows = rows.sort(
            (a, b) => (a.decoded[field] as Date).getTime() - (b.decoded[field] as Date).getTime(),
          );
        }
        rows = rows.slice(0, limitN);
        const docs = rows.map(({ key, decoded }) => ({
          id: key.slice(prefix.length),
          data: () => decoded,
        }));
        return Promise.resolve({ docs, empty: docs.length === 0 });
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

/** Seeds an awaiting_payment order, its active-but-expired reservation, and inventory holding it. */
function seed(
  options: {
    orderStatus?: OrderDoc['status'];
    reservationStatus?: ReservationDoc['status'];
    reserved?: number;
  } = {},
): StoredDoc[] {
  const order = anOrder({
    status: options.orderStatus ?? 'awaiting_payment',
    reservationId: RES_ID as OrderDoc['reservationId'],
    // A paid order needs a verifier; give one so the fixture validates when we test that branch.
    ...(options.orderStatus === 'paid'
      ? {
          payment: {
            ...anOrder().payment,
            upiRef: '999999999999' as OrderDoc['payment']['upiRef'],
            submittedAt: NOW,
            verifiedBy: 'staff-uid-0001' as OrderDoc['payment']['verifiedBy'],
            verifiedAt: NOW,
          },
        }
      : {}),
  });
  const reservation = aReservation({
    orderId: ORDER_ID as ReservationDoc['orderId'],
    status: options.reservationStatus ?? 'active',
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    expiresAt: new Date(NOW.getTime() - 60 * 1000), // expired a minute ago
    resolvedAt: options.reservationStatus && options.reservationStatus !== 'active' ? NOW : null,
    items: [
      {
        variantId: VARIANT as never,
        qty: 2,
        allocation: { blr: 2 } as never,
      },
    ],
  });
  const inventory = anInventoryRecord({
    stock: { blr: 10 } as ReturnType<typeof anInventoryRecord>['stock'],
    onHandTotal: 10,
    reserved: options.reserved ?? 2,
  });
  return [
    { path: `orders/${ORDER_ID}`, data: converters.orders.toFirestore(order) },
    { path: `reservations/${RES_ID}`, data: converters.reservations.toFirestore(reservation) },
    { path: `inventory/${VARIANT}`, data: converters.inventory.toFirestore(inventory) },
  ];
}

describe('releaseReservation', () => {
  it('lowers reserved, expires the order and marks the reservation released', async () => {
    const { db, store } = fakeDb(seed({ reserved: 2 }));
    const outcome = await releaseReservation(ctxWith(db), RES_ID);

    expect(outcome.released).toBe(true);
    expect(store.get(`inventory/${VARIANT}`)?.reserved).toBe(0);
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('expired');
    const reservation = store.get(`reservations/${RES_ID}`);
    expect(reservation?.status).toBe('released');
    expect(reservation?.resolvedAt).not.toBeNull();
  });

  it('is a no-op when the reservation is already released', async () => {
    const { db, store } = fakeDb(seed({ reservationStatus: 'released', reserved: 0 }));
    const outcome = await releaseReservation(ctxWith(db), RES_ID);
    expect(outcome).toEqual({ released: false, reason: 'reservation_not_active' });
    // Order untouched.
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('awaiting_payment');
  });

  it('is a no-op when the order has moved to pending_verification (proof submitted)', async () => {
    const { db, store } = fakeDb(seed({ orderStatus: 'pending_verification', reserved: 2 }));
    const outcome = await releaseReservation(ctxWith(db), RES_ID);
    expect(outcome).toEqual({ released: false, reason: 'order_not_holding' });
    // Reserved not touched — the order still holds its stock, pending admin verification.
    expect(store.get(`inventory/${VARIANT}`)?.reserved).toBe(2);
    expect(store.get(`reservations/${RES_ID}`)?.status).toBe('active');
  });

  it('is a no-op when the reservation is absent', async () => {
    const { db } = fakeDb([]);
    expect(await releaseReservation(ctxWith(db), RES_ID)).toEqual({
      released: false,
      reason: 'reservation_absent',
    });
  });

  it('releases a payment_rejected order too', async () => {
    const { db, store } = fakeDb(seed({ orderStatus: 'payment_rejected', reserved: 2 }));
    const outcome = await releaseReservation(ctxWith(db), RES_ID);
    expect(outcome.released).toBe(true);
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('expired');
  });

  it('releases even when the inventory record has vanished, skipping the missing line', async () => {
    const seededWithoutInventory = seed({ reserved: 2 }).filter(
      (d) => !d.path.startsWith('inventory/'),
    );
    const { db, store } = fakeDb(seededWithoutInventory);
    const outcome = await releaseReservation(ctxWith(db), RES_ID);
    expect(outcome.released).toBe(true);
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('expired');
  });
});

describe('sweepExpiredReservations', () => {
  it('releases every overdue reservation and reports the counts', async () => {
    const { db, store } = fakeDb(seed({ reserved: 2 }));
    const result = await sweepExpiredReservations(ctxWith(db));
    expect(result).toEqual({ found: 1, released: 1, skipped: 0 });
    expect(store.get(`inventory/${VARIANT}`)?.reserved).toBe(0);
  });

  it('is idempotent — a second pass finds nothing to release', async () => {
    const { db } = fakeDb(seed({ reserved: 2 }));
    const ctx = ctxWith(db);
    await sweepExpiredReservations(ctx);
    const second = await sweepExpiredReservations(ctx);
    // The reservation is released now, so it no longer matches the active+expired query.
    expect(second).toEqual({ found: 0, released: 0, skipped: 0 });
  });

  it('skips an overdue reservation whose order has moved on, without releasing it', async () => {
    // The reservation is active + expired (so the sweep lists it), but the order is now
    // pending_verification — the customer submitted proof — so release is a no-op.
    const { db, store } = fakeDb(seed({ orderStatus: 'pending_verification', reserved: 2 }));
    const result = await sweepExpiredReservations(ctxWith(db));
    expect(result).toEqual({ found: 1, released: 0, skipped: 1 });
    expect(store.get(`inventory/${VARIANT}`)?.reserved).toBe(2);
    expect(store.get(`reservations/${RES_ID}`)?.status).toBe('active');
  });

  it('reports nothing when there is nothing overdue', async () => {
    const future = seed({ reserved: 2 });
    // Push the reservation's expiry into the future.
    const reservation = aReservation({
      orderId: ORDER_ID as ReservationDoc['orderId'],
      status: 'active',
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      resolvedAt: null,
    });
    future[1] = {
      path: `reservations/${RES_ID}`,
      data: converters.reservations.toFirestore(reservation),
    };
    const { db } = fakeDb(future);
    expect(await sweepExpiredReservations(ctxWith(db))).toEqual({
      found: 0,
      released: 0,
      skipped: 0,
    });
  });
});
