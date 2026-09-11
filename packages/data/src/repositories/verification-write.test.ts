import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { OrderDoc, ReservationDoc } from '@romp/contracts';
import { anInventoryRecord, anOrder, aReservation } from '@romp/contracts/fixtures';
import {
  InvalidStateTransitionError,
  NotFoundError,
  PaymentAmountMismatchError,
} from '@romp/observability';

import { fixedClock } from '../clock';
import { asOperator, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import { rejectPayment, verifyPayment } from './verification-write';

/**
 * Unit tests for payment verification.
 *
 * The end-to-end stock movement is proven against the emulator; here a stateful Firestore double
 * asserts the orchestration: an exact-amount verify commits stock (on-hand and reserved fall
 * together, an `order_committed` ledger entry is written, the reservation resolves to `committed`,
 * the order is paid with the admin recorded); a mismatched amount is refused; a reject records the
 * reason and leaves stock reserved.
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ORDER_ID = 'order-1';
const RES_ID = 'res-1';
const VARIANT = 'WB-240';
const STAFF = asOperator('staff-uid-0001', 'staff');
const TOTAL = 2_90_976; // matches anOrder() default total

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
      get: () =>
        Promise.resolve({
          id: ref.id,
          exists: store.get(path) !== undefined,
          data: () => decode(path, store.get(path), converter),
        }),
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

/** Seeds a pending_verification order, its active reservation, and inventory holding it. */
function seed(
  overrides: { orderStatus?: OrderDoc['status']; reserved?: number } = {},
): StoredDoc[] {
  const status = overrides.orderStatus ?? 'pending_verification';
  const paid = status === 'paid';
  const order = anOrder({
    status,
    reservationId: RES_ID as OrderDoc['reservationId'],
    payment: {
      ...anOrder().payment,
      upiRef: '412398765432' as OrderDoc['payment']['upiRef'],
      submittedAt: NOW,
      // A paid order must record its verifier (OrderDoc refine).
      ...(paid
        ? {
            verifiedBy: 'staff-uid-0001' as OrderDoc['payment']['verifiedBy'],
            verifiedAt: NOW,
          }
        : {}),
    },
  });
  const reservation = aReservation({
    orderId: ORDER_ID as ReservationDoc['orderId'],
    status: 'active',
    createdAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    expiresAt: new Date(NOW.getTime() + 20 * 60 * 1000),
    resolvedAt: null,
    items: [{ variantId: VARIANT as never, qty: 2, allocation: { blr: 2 } as never }],
  });
  const inventory = anInventoryRecord({
    stock: { blr: 10 } as ReturnType<typeof anInventoryRecord>['stock'],
    onHandTotal: 10,
    reserved: overrides.reserved ?? 2,
  });
  return [
    { path: `orders/${ORDER_ID}`, data: converters.orders.toFirestore(order) },
    { path: `reservations/${RES_ID}`, data: converters.reservations.toFirestore(reservation) },
    { path: `inventory/${VARIANT}`, data: converters.inventory.toFirestore(inventory) },
  ];
}

describe('verifyPayment', () => {
  it('commits stock and marks the order paid on an exact-amount match', async () => {
    const { db, store } = fakeDb(seed({ reserved: 2 }));
    const result = await verifyPayment(ctxWith(db), STAFF, {
      orderId: ORDER_ID,
      paidAmountMinor: TOTAL,
    });

    expect(result.status).toBe('paid');
    const order = store.get(`orders/${ORDER_ID}`);
    expect(order?.status).toBe('paid');
    expect((order?.payment as { verifiedBy: string }).verifiedBy).toBe('staff-uid-0001');

    // On-hand and reserved fell together: 10 -> 8, reserved 2 -> 0.
    const inventory = store.get(`inventory/${VARIANT}`);
    expect(inventory?.onHandTotal).toBe(8);
    expect(inventory?.reserved).toBe(0);
    expect((inventory?.stock as Record<string, number>).blr).toBe(8);

    // The reservation is committed.
    expect(store.get(`reservations/${RES_ID}`)?.status).toBe('committed');

    // An order_committed ledger entry with a negative delta was written.
    const ledger = [...store.entries()].find(([key]) => key.startsWith('inventoryLedger/'));
    expect(ledger).toBeDefined();
    expect(ledger?.[1].reason).toBe('order_committed');
    expect(ledger?.[1].delta).toBe(-2);
  });

  it('refuses a short payment without marking paid or moving stock', async () => {
    const { db, store } = fakeDb(seed({ reserved: 2 }));
    await expect(
      verifyPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, paidAmountMinor: TOTAL - 100 }),
    ).rejects.toBeInstanceOf(PaymentAmountMismatchError);
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('pending_verification');
    expect(store.get(`inventory/${VARIANT}`)?.reserved).toBe(2);
  });

  it('refuses an overpayment the same way — never "close enough"', async () => {
    const { db } = fakeDb(seed({ reserved: 2 }));
    await expect(
      verifyPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, paidAmountMinor: TOTAL + 100 }),
    ).rejects.toBeInstanceOf(PaymentAmountMismatchError);
  });

  it('refuses to verify an order that is not pending verification', async () => {
    const { db } = fakeDb(seed({ orderStatus: 'awaiting_payment' }));
    await expect(
      verifyPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, paidAmountMinor: TOTAL }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('404s a missing order', async () => {
    const { db } = fakeDb([]);
    await expect(
      verifyPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, paidAmountMinor: TOTAL }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses an order with no reservation to commit', async () => {
    const seeded = seed({ reserved: 2 });
    // Rewrite the order with a null reservationId (schema-legal, but nothing to commit).
    seeded[0] = {
      path: `orders/${ORDER_ID}`,
      data: converters.orders.toFirestore(
        anOrder({
          status: 'pending_verification',
          reservationId: null,
          payment: {
            ...anOrder().payment,
            upiRef: '412398765432' as OrderDoc['payment']['upiRef'],
            submittedAt: NOW,
          },
        }),
      ),
    };
    const { db } = fakeDb(seeded);
    await expect(
      verifyPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, paidAmountMinor: TOTAL }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('refuses when a reserved variant has no inventory record', async () => {
    const seeded = seed({ reserved: 2 }).filter((d) => !d.path.startsWith('inventory/'));
    const { db } = fakeDb(seeded);
    await expect(
      verifyPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, paidAmountMinor: TOTAL }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('refuses when the allocated warehouse cannot cover its units (broken invariant)', async () => {
    const seeded = seed({ reserved: 2 });
    // The reservation allocated 2 to `blr`, but the on-hand sits entirely at a different
    // warehouse — a valid inventory doc (onHand 2, reserved 2) that still cannot commit `blr`.
    seeded[2] = {
      path: `inventory/${VARIANT}`,
      data: converters.inventory.toFirestore(
        anInventoryRecord({
          stock: { del: 2 } as ReturnType<typeof anInventoryRecord>['stock'],
          onHandTotal: 2,
          reserved: 2,
        }),
      ),
    };
    const { db } = fakeDb(seeded);
    await expect(
      verifyPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, paidAmountMinor: TOTAL }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('refuses when the reservation is no longer active', async () => {
    const seeded = seed({ reserved: 2 });
    seeded[1] = {
      path: `reservations/${RES_ID}`,
      data: converters.reservations.toFirestore(
        aReservation({
          orderId: ORDER_ID as ReservationDoc['orderId'],
          status: 'released',
          createdAt: new Date(NOW.getTime() - 10 * 60 * 1000),
          expiresAt: new Date(NOW.getTime() + 20 * 60 * 1000),
          resolvedAt: NOW,
          items: [{ variantId: VARIANT as never, qty: 2, allocation: { blr: 2 } as never }],
        }),
      ),
    };
    const { db } = fakeDb(seeded);
    await expect(
      verifyPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, paidAmountMinor: TOTAL }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});

describe('rejectPayment', () => {
  it('records the reason, rejects the order, and leaves stock reserved', async () => {
    const { db, store } = fakeDb(seed({ reserved: 2 }));
    const result = await rejectPayment(ctxWith(db), STAFF, {
      orderId: ORDER_ID,
      reason: 'The reference did not match any payment.',
    });

    expect(result.status).toBe('payment_rejected');
    const order = store.get(`orders/${ORDER_ID}`);
    expect(order?.status).toBe('payment_rejected');
    const payment = order?.payment as { rejectedBy: string; rejectionReason: string };
    expect(payment.rejectedBy).toBe('staff-uid-0001');
    expect(payment.rejectionReason).toBe('The reference did not match any payment.');
    // Stock stays reserved for a resubmission.
    expect(store.get(`inventory/${VARIANT}`)?.reserved).toBe(2);
    // The reservation is untouched.
    expect(store.get(`reservations/${RES_ID}`)?.status).toBe('active');
  });

  it('refuses to reject an order that is not pending verification', async () => {
    const { db } = fakeDb(seed({ orderStatus: 'paid' }));
    await expect(
      rejectPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, reason: 'x' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('404s a missing order', async () => {
    const { db } = fakeDb([]);
    await expect(
      rejectPayment(ctxWith(db), STAFF, { orderId: ORDER_ID, reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
