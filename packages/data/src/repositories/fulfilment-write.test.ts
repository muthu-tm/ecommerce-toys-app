import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { FulfilmentStatus, OrderDoc } from '@romp/contracts';
import { anOrder } from '@romp/contracts/fixtures';
import { InvalidStateTransitionError, NotFoundError } from '@romp/observability';

import { fixedClock } from '../clock';
import { asOperator, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import { advanceFulfilment } from './fulfilment-write';

/**
 * Unit tests for fulfilment advancement.
 *
 * A stateful Firestore double asserts the orchestration: a legal advance stamps the stage's
 * timestamp and moves the fulfilment status; packing an unpaid order is refused (the cross-machine
 * guard); shipping without a carrier is refused; an illegal transition is refused by the machine;
 * and the customer-visible stages append an audit event while `on_hold` does not.
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ORDER_ID = 'order-1';
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

/** Seeds one order at a given payment and fulfilment status. */
function seedOrder(
  overrides: {
    status?: OrderDoc['status'];
    fulfilmentStatus?: FulfilmentStatus;
    fulfilment?: Partial<OrderDoc['fulfilment']>;
  } = {},
): StoredDoc[] {
  const status = overrides.status ?? 'paid';
  const paid = status === 'paid';
  const order = anOrder({
    status,
    fulfilment: {
      ...anOrder().fulfilment,
      status: overrides.fulfilmentStatus ?? 'unfulfilled',
      ...overrides.fulfilment,
    },
    payment: {
      ...anOrder().payment,
      ...(paid
        ? {
            upiRef: '412398765432' as OrderDoc['payment']['upiRef'],
            submittedAt: NOW,
            verifiedBy: 'staff-uid-0001' as OrderDoc['payment']['verifiedBy'],
            verifiedAt: NOW,
          }
        : {}),
    },
  });
  return [{ path: `orders/${ORDER_ID}`, data: converters.orders.toFirestore(order) }];
}

function ledgerCount(store: Map<string, Record<string, unknown>>, prefix: string): number {
  return [...store.keys()].filter((key) => key.startsWith(prefix)).length;
}

describe('advanceFulfilment', () => {
  it('packs a paid order, stamps packedAt, and appends an order.packed event', async () => {
    const { db, store } = fakeDb(seedOrder({ status: 'paid', fulfilmentStatus: 'unfulfilled' }));
    const result = await advanceFulfilment(ctxWith(db), STAFF, {
      orderId: ORDER_ID,
      status: 'packed',
    });

    expect(result.status).toBe('packed');
    const order = store.get(`orders/${ORDER_ID}`);
    expect((order?.fulfilment as { status: string }).status).toBe('packed');
    expect((order?.fulfilment as { packedAt: unknown }).packedAt).not.toBeNull();

    // Both the per-order event and the spine event were written.
    expect(ledgerCount(store, `orders/${ORDER_ID}/events/`)).toBe(1);
    expect(ledgerCount(store, 'events/')).toBe(1);
  });

  it('refuses to pack an order whose payment is not verified', async () => {
    const { db, store } = fakeDb(
      seedOrder({ status: 'pending_verification', fulfilmentStatus: 'unfulfilled' }),
    );
    await expect(
      advanceFulfilment(ctxWith(db), STAFF, { orderId: ORDER_ID, status: 'packed' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect((store.get(`orders/${ORDER_ID}`)?.fulfilment as { status: string }).status).toBe(
      'unfulfilled',
    );
  });

  it('ships a packed order with a carrier and tracking, appending both figures', async () => {
    const { db, store } = fakeDb(
      seedOrder({ status: 'paid', fulfilmentStatus: 'packed', fulfilment: { packedAt: NOW } }),
    );
    const result = await advanceFulfilment(ctxWith(db), STAFF, {
      orderId: ORDER_ID,
      status: 'shipped',
      carrier: 'Delhivery',
      trackingNo: 'DL123456',
    });

    expect(result.status).toBe('shipped');
    const fulfilment = store.get(`orders/${ORDER_ID}`)?.fulfilment as {
      carrier: string;
      trackingNo: string;
      shippedAt: unknown;
      packedAt: unknown;
    };
    expect(fulfilment.carrier).toBe('Delhivery');
    expect(fulfilment.trackingNo).toBe('DL123456');
    expect(fulfilment.shippedAt).not.toBeNull();
    // packedAt is preserved across the advance.
    expect(fulfilment.packedAt).not.toBeNull();
  });

  it('refuses to ship without a carrier and tracking number', async () => {
    const { db } = fakeDb(
      seedOrder({ status: 'paid', fulfilmentStatus: 'packed', fulfilment: { packedAt: NOW } }),
    );
    await expect(
      advanceFulfilment(ctxWith(db), STAFF, { orderId: ORDER_ID, status: 'shipped' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('marks a shipped order delivered', async () => {
    const { db, store } = fakeDb(
      seedOrder({
        status: 'paid',
        fulfilmentStatus: 'shipped',
        fulfilment: {
          packedAt: NOW,
          shippedAt: NOW,
          carrier: 'Delhivery',
          trackingNo: 'DL123456',
        },
      }),
    );
    const result = await advanceFulfilment(ctxWith(db), STAFF, {
      orderId: ORDER_ID,
      status: 'delivered',
    });

    expect(result.status).toBe('delivered');
    expect(
      (store.get(`orders/${ORDER_ID}`)?.fulfilment as { deliveredAt: unknown }).deliveredAt,
    ).not.toBeNull();
    expect(ledgerCount(store, 'events/')).toBe(1);
  });

  it('places an order on hold with a reason and announces nothing to the customer', async () => {
    const { db, store } = fakeDb(seedOrder({ status: 'paid', fulfilmentStatus: 'unfulfilled' }));
    const result = await advanceFulfilment(ctxWith(db), STAFF, {
      orderId: ORDER_ID,
      status: 'on_hold',
      holdReason: 'Awaiting a replacement for a damaged unit.',
    });

    expect(result.status).toBe('on_hold');
    expect((store.get(`orders/${ORDER_ID}`)?.fulfilment as { holdReason: string }).holdReason).toBe(
      'Awaiting a replacement for a damaged unit.',
    );
    // on_hold is internal: no customer notification is projected.
    expect(ledgerCount(store, 'events/')).toBe(0);
    expect(ledgerCount(store, `orders/${ORDER_ID}/events/`)).toBe(0);
  });

  it('refuses to place an order on hold with no reason', async () => {
    const { db } = fakeDb(seedOrder({ status: 'paid', fulfilmentStatus: 'unfulfilled' }));
    await expect(
      advanceFulfilment(ctxWith(db), STAFF, { orderId: ORDER_ID, status: 'on_hold' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('clears the hold reason when coming back off hold', async () => {
    const { db, store } = fakeDb(
      seedOrder({
        status: 'paid',
        fulfilmentStatus: 'on_hold',
        fulfilment: { holdReason: 'Address unreachable.' },
      }),
    );
    await advanceFulfilment(ctxWith(db), STAFF, { orderId: ORDER_ID, status: 'unfulfilled' });
    expect(
      (store.get(`orders/${ORDER_ID}`)?.fulfilment as { holdReason: unknown }).holdReason,
    ).toBeNull();
  });

  it('refuses an illegal fulfilment transition', async () => {
    // shipped -> packed is not an edge.
    const { db } = fakeDb(
      seedOrder({
        status: 'paid',
        fulfilmentStatus: 'shipped',
        fulfilment: {
          packedAt: NOW,
          shippedAt: NOW,
          carrier: 'Delhivery',
          trackingNo: 'DL123456',
        },
      }),
    );
    await expect(
      advanceFulfilment(ctxWith(db), STAFF, { orderId: ORDER_ID, status: 'packed' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('refuses to cancel through the fulfilment action (use cancelOrder)', async () => {
    const { db } = fakeDb(seedOrder({ status: 'paid', fulfilmentStatus: 'unfulfilled' }));
    await expect(
      advanceFulfilment(ctxWith(db), STAFF, { orderId: ORDER_ID, status: 'cancelled' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('404s a missing order', async () => {
    const { db } = fakeDb([]);
    await expect(
      advanceFulfilment(ctxWith(db), STAFF, { orderId: ORDER_ID, status: 'packed' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
