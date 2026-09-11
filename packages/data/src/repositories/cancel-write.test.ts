import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { FulfilmentStatus, OrderDoc, ReservationDoc } from '@romp/contracts';
import { anInventoryRecord, anOrder, aReservation } from '@romp/contracts/fixtures';
import { InvalidStateTransitionError, NotFoundError } from '@romp/observability';

import { fixedClock } from '../clock';
import { asOperator, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import { cancelOrder } from './cancel-write';

/**
 * Unit tests for order cancellation.
 *
 * A stateful Firestore double asserts the two shapes of undo: a pre-payment cancel releases the
 * reservation and lowers `reserved` with no ledger entry (on-hand never moved); a paid cancel with
 * restock raises on-hand and writes an `order_cancelled` ledger entry; a paid cancel without restock
 * touches no inventory. Both move the order and its fulfilment to `cancelled`, and illegal
 * cancellations are refused.
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ORDER_ID = 'order-1';
const RES_ID = 'res-1';
const VARIANT = 'WB-240';
const STAFF = asOperator('staff-uid-0001', 'staff');

interface StoredDoc {
  readonly path: string;
  data: Record<string, unknown>;
}

interface Converter {
  toFirestore: (v: unknown) => Record<string, unknown>;
  fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
}

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

/** Seeds an order at a given status, plus its reservation and inventory holding 2 units. */
function seed(
  overrides: {
    orderStatus?: OrderDoc['status'];
    fulfilmentStatus?: FulfilmentStatus;
    reserved?: number;
    onHand?: number;
    withReservation?: boolean;
    reservationStatus?: ReservationDoc['status'];
  } = {},
): StoredDoc[] {
  const status = overrides.orderStatus ?? 'awaiting_payment';
  const paid = status === 'paid';
  const settled = status === 'paid' || status === 'refunded';
  const withReservation = overrides.withReservation ?? true;
  const refunded = status === 'refunded';
  const order = anOrder({
    status,
    fulfilment: { ...anOrder().fulfilment, status: overrides.fulfilmentStatus ?? 'unfulfilled' },
    reservationId: withReservation ? (RES_ID as OrderDoc['reservationId']) : null,
    items: [
      { ...anOrder().items[0]!, variantId: VARIANT as OrderDoc['items'][number]['variantId'] },
    ],
    allocation: { [VARIANT]: { blr: 2 } } as unknown as OrderDoc['allocation'],
    // A refunded order must carry a refunded amount (OrderDoc refine).
    ...(refunded
      ? { amounts: { ...anOrder().amounts, refundedMinor: anOrder().amounts.totalMinor } }
      : {}),
    payment: {
      ...anOrder().payment,
      ...(settled
        ? {
            upiRef: '412398765432' as OrderDoc['payment']['upiRef'],
            submittedAt: NOW,
            verifiedBy: 'staff-uid-0001' as OrderDoc['payment']['verifiedBy'],
            verifiedAt: NOW,
          }
        : {}),
    },
  });
  const docs: StoredDoc[] = [
    { path: `orders/${ORDER_ID}`, data: converters.orders.toFirestore(order) },
  ];
  if (withReservation) {
    docs.push({
      path: `reservations/${RES_ID}`,
      data: converters.reservations.toFirestore(
        aReservation({
          orderId: ORDER_ID as ReservationDoc['orderId'],
          status: overrides.reservationStatus ?? (paid ? 'committed' : 'active'),
          createdAt: new Date(NOW.getTime() - 10 * 60 * 1000),
          expiresAt: new Date(NOW.getTime() + 20 * 60 * 1000),
          resolvedAt: paid ? NOW : null,
          items: [{ variantId: VARIANT as never, qty: 2, allocation: { blr: 2 } as never }],
        }),
      ),
    });
  }
  docs.push({
    path: `inventory/${VARIANT}`,
    data: converters.inventory.toFirestore(
      anInventoryRecord({
        stock: { blr: overrides.onHand ?? 10 } as ReturnType<typeof anInventoryRecord>['stock'],
        onHandTotal: overrides.onHand ?? 10,
        reserved: overrides.reserved ?? (paid ? 0 : 2),
      }),
    ),
  });
  return docs;
}

function ledgerEntries(store: Map<string, Record<string, unknown>>): Record<string, unknown>[] {
  return [...store.entries()]
    .filter(([key]) => key.startsWith('inventoryLedger/'))
    .map(([, value]) => value);
}

describe('cancelOrder — before payment', () => {
  it('releases the reservation, lowers reserved, writes no ledger entry', async () => {
    const { db, store } = fakeDb(seed({ orderStatus: 'awaiting_payment', reserved: 2 }));
    const result = await cancelOrder(ctxWith(db), STAFF, {
      orderId: ORDER_ID,
      reason: 'Customer changed their mind.',
      restock: false,
    });

    expect(result.status).toBe('cancelled');
    const order = store.get(`orders/${ORDER_ID}`);
    expect(order?.status).toBe('cancelled');
    expect((order?.fulfilment as { status: string }).status).toBe('cancelled');

    // reserved fell; on-hand unchanged; no ledger entry.
    const inventory = store.get(`inventory/${VARIANT}`);
    expect(inventory?.reserved).toBe(0);
    expect(inventory?.onHandTotal).toBe(10);
    expect(ledgerEntries(store)).toHaveLength(0);

    // The reservation is released.
    expect(store.get(`reservations/${RES_ID}`)?.status).toBe('released');
  });

  it('cancels a rejected-payment order the same way (still holding)', async () => {
    const { db, store } = fakeDb(seed({ orderStatus: 'payment_rejected', reserved: 2 }));
    await cancelOrder(ctxWith(db), STAFF, { orderId: ORDER_ID, reason: 'x', restock: false });
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('cancelled');
    expect(store.get(`inventory/${VARIANT}`)?.reserved).toBe(0);
    expect(store.get(`reservations/${RES_ID}`)?.status).toBe('released');
  });
});

describe('cancelOrder — after payment', () => {
  it('restocks on-hand and writes an order_cancelled ledger entry when asked', async () => {
    // Paid: committed already dropped on-hand to 8, reserved 0.
    const { db, store } = fakeDb(seed({ orderStatus: 'paid', onHand: 8, reserved: 0 }));
    const result = await cancelOrder(ctxWith(db), STAFF, {
      orderId: ORDER_ID,
      reason: 'Damaged in the warehouse.',
      restock: true,
    });

    expect(result.status).toBe('cancelled');
    const inventory = store.get(`inventory/${VARIANT}`);
    // On-hand rises back: 8 -> 10.
    expect(inventory?.onHandTotal).toBe(10);
    expect((inventory?.stock as Record<string, number>).blr).toBe(10);

    const ledger = ledgerEntries(store);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.reason).toBe('order_cancelled');
    expect(ledger[0]?.delta).toBe(2);
  });

  it('leaves inventory untouched when restock is false', async () => {
    const { db, store } = fakeDb(seed({ orderStatus: 'paid', onHand: 8, reserved: 0 }));
    await cancelOrder(ctxWith(db), STAFF, {
      orderId: ORDER_ID,
      reason: 'Goods not resellable.',
      restock: false,
    });

    const inventory = store.get(`inventory/${VARIANT}`);
    expect(inventory?.onHandTotal).toBe(8);
    expect(ledgerEntries(store)).toHaveLength(0);
    // The order is still cancelled on both machines.
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('cancelled');
    expect((store.get(`orders/${ORDER_ID}`)?.fulfilment as { status: string }).status).toBe(
      'cancelled',
    );
  });
});

describe('cancelOrder — refusals', () => {
  it('refuses to cancel an expired order (terminal on the order machine)', async () => {
    const { db } = fakeDb(seed({ orderStatus: 'expired', withReservation: false }));
    await expect(
      cancelOrder(ctxWith(db), STAFF, { orderId: ORDER_ID, reason: 'x', restock: false }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('refuses to cancel a refunded order', async () => {
    const { db } = fakeDb(seed({ orderStatus: 'refunded', withReservation: false }));
    await expect(
      cancelOrder(ctxWith(db), STAFF, { orderId: ORDER_ID, reason: 'x', restock: false }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('refuses to cancel an order that has already shipped (fulfilment terminal-ish)', async () => {
    const { db } = fakeDb(
      seed({ orderStatus: 'paid', fulfilmentStatus: 'shipped', onHand: 8, reserved: 0 }),
    );
    await expect(
      cancelOrder(ctxWith(db), STAFF, { orderId: ORDER_ID, reason: 'x', restock: true }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('404s a missing order', async () => {
    const { db } = fakeDb([]);
    await expect(
      cancelOrder(ctxWith(db), STAFF, { orderId: ORDER_ID, reason: 'x', restock: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
