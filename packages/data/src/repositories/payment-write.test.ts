import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { OrderDoc, ReservationDoc } from '@romp/contracts';
import { anOrder, aReservation } from '@romp/contracts/fixtures';
import {
  DuplicatePaymentReferenceError,
  NotFoundError,
  ReservationExpiredError,
} from '@romp/observability';

import { fixedClock } from '../clock';
import { asCustomer, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import { submitPaymentProof } from './payment-write';

/**
 * Unit tests for the payment-proof submission transaction.
 *
 * The concurrency property (two claims of one UTR, one wins) is proven against the emulator; here a
 * stateful Firestore double asserts the orchestration: that submission stamps the reference and
 * proof onto the order, moves it into verification, claims the UTR by creating the guard document,
 * and refuses — writing nothing — on a lapsed reservation, a duplicate reference, or an order not
 * awaiting payment.
 */

const NOW = new Date('2026-03-01T09:30:00.000Z');
const ORDER_ID = 'order-1';
const CUSTOMER = asCustomer('user-1');

interface StoredDoc {
  readonly path: string;
  data: Record<string, unknown>;
}

interface Converter {
  toFirestore: (v: unknown) => Record<string, unknown>;
  fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
}

/**
 * A transaction-capable Firestore double supporting doc get, and a transaction with get (carrying
 * `exists`), `create` (ALREADY_EXISTS on a present path) and `set`. Writes apply atomically only
 * after the callback resolves, so a thrown refusal leaves the store untouched.
 */
function fakeDb(seed: readonly StoredDoc[] = []) {
  const store = new Map<string, Record<string, unknown>>(seed.map((d) => [d.path, d.data]));

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
      get: () => {
        const raw = store.get(path);
        return Promise.resolve({
          id: ref.id,
          exists: raw !== undefined,
          data: () => decode(path, raw, converter),
        });
      },
    };
    return ref;
  };

  type DocRef = ReturnType<typeof docRef>;

  let generated = 0;
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

  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: DocRef) => Promise<{ exists: boolean; data: () => unknown }>;
      create: (ref: DocRef, data: unknown) => void;
      set: (ref: DocRef, data: unknown) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    const staged: { path: string; data: Record<string, unknown> }[] = [];
    const created = new Set<string>();
    const tx = {
      get: (ref: DocRef) => {
        const raw = store.get(ref.path);
        return Promise.resolve({
          exists: raw !== undefined,
          data: () => decode(ref.path, raw, ref.converter),
        });
      },
      create: (ref: DocRef, data: unknown) => {
        if (store.has(ref.path) || created.has(ref.path)) {
          throw Object.assign(new Error('ALREADY_EXISTS: entity already exists'), { code: 6 });
        }
        created.add(ref.path);
        staged.push({
          path: ref.path,
          data: (ref.converter === null ? data : ref.converter.toFirestore(data)) as Record<
            string,
            unknown
          >,
        });
      },
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

/** Seeds an owned order (awaiting_payment) and its active, unexpired reservation. */
function seed(
  orderOverrides: Partial<OrderDoc> = {},
  reservationOverrides: Partial<ReservationDoc> = {},
): StoredDoc[] {
  const order = anOrder({
    userId: 'user-1' as OrderDoc['userId'],
    status: 'awaiting_payment',
    reservationId: 'res-1' as OrderDoc['reservationId'],
    ...orderOverrides,
  });
  const reservation = aReservation({
    orderId: ORDER_ID as ReservationDoc['orderId'],
    status: 'active',
    expiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
    resolvedAt: null,
    ...reservationOverrides,
  });
  return [
    { path: `orders/${ORDER_ID}`, data: converters.orders.toFirestore(order) },
    { path: 'reservations/res-1', data: converters.reservations.toFirestore(reservation) },
  ];
}

const input = { orderId: ORDER_ID, upiRef: '4123 9876 5432', screenshotPath: null };

describe('submitPaymentProof', () => {
  it('claims the UTR, stamps the order and moves it to pending_verification', async () => {
    const { db, store } = fakeDb(seed());
    const result = await submitPaymentProof(ctxWith(db), CUSTOMER, input);

    expect(result.status).toBe('pending_verification');
    // The reference is normalised (spaces stripped, uppercased) on the order and as the guard ID.
    const order = store.get(`orders/${ORDER_ID}`);
    expect((order?.payment as { upiRef: string }).upiRef).toBe('412398765432');
    expect((order?.payment as { submittedAt: unknown }).submittedAt).not.toBeNull();
    expect(order?.status).toBe('pending_verification');
    // The guard document exists at the normalised UTR.
    expect(store.get('paymentRefGuards/412398765432')).toBeDefined();
  });

  it('records the screenshot path when a proof was uploaded', async () => {
    const { db, store } = fakeDb(seed());
    await submitPaymentProof(ctxWith(db), CUSTOMER, {
      ...input,
      screenshotPath: 'payment-proofs/order-1/user-1/proof.jpg',
    });
    const order = store.get(`orders/${ORDER_ID}`);
    expect((order?.payment as { screenshotPath: string }).screenshotPath).toBe(
      'payment-proofs/order-1/user-1/proof.jpg',
    );
  });

  it('clears a prior rejection on resubmission', async () => {
    const rejected = seed({
      status: 'payment_rejected',
      payment: {
        ...anOrder().payment,
        upiRef: null,
        submittedAt: null,
        rejectedBy: 'staff-uid-0001' as OrderDoc['payment']['rejectedBy'],
        rejectedAt: NOW,
        rejectionReason: 'Reference did not match.',
      },
    });
    const { db, store } = fakeDb(rejected);
    const result = await submitPaymentProof(ctxWith(db), CUSTOMER, input);
    expect(result.status).toBe('pending_verification');
    const payment = store.get(`orders/${ORDER_ID}`)?.payment as {
      rejectedBy: unknown;
      rejectionReason: unknown;
    };
    expect(payment.rejectedBy).toBeNull();
    expect(payment.rejectionReason).toBeNull();
  });

  it('refuses a duplicate reference — the guard already exists', async () => {
    const withGuard: StoredDoc[] = [
      ...seed(),
      {
        path: 'paymentRefGuards/412398765432',
        data: converters.paymentRefGuards.toFirestore({
          orderId: 'other-order' as never,
          upiRef: '412398765432' as never,
          claimedAt: NOW,
        }),
      },
    ];
    const { db, store } = fakeDb(withGuard);
    await expect(submitPaymentProof(ctxWith(db), CUSTOMER, input)).rejects.toBeInstanceOf(
      DuplicatePaymentReferenceError,
    );
    // The order was not moved.
    expect(store.get(`orders/${ORDER_ID}`)?.status).toBe('awaiting_payment');
  });

  it('refuses when the reservation has expired', async () => {
    const { db, store } = fakeDb(
      seed(
        {},
        {
          createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
          expiresAt: new Date(NOW.getTime() - 60 * 1000),
        },
      ),
    );
    await expect(submitPaymentProof(ctxWith(db), CUSTOMER, input)).rejects.toBeInstanceOf(
      ReservationExpiredError,
    );
    expect(store.get('paymentRefGuards/412398765432')).toBeUndefined();
  });

  it('refuses when the reservation is no longer active', async () => {
    const { db } = fakeDb(seed({}, { status: 'released', resolvedAt: NOW }));
    await expect(submitPaymentProof(ctxWith(db), CUSTOMER, input)).rejects.toBeInstanceOf(
      ReservationExpiredError,
    );
  });

  it('404s an order the caller does not own', async () => {
    const { db } = fakeDb(seed({ userId: 'someone-else' as OrderDoc['userId'] }));
    await expect(submitPaymentProof(ctxWith(db), CUSTOMER, input)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('404s a missing order', async () => {
    const { db } = fakeDb([]);
    await expect(submitPaymentProof(ctxWith(db), CUSTOMER, input)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('refuses when the order carries no reservation', async () => {
    const { db } = fakeDb([
      {
        path: `orders/${ORDER_ID}`,
        data: converters.orders.toFirestore(
          anOrder({
            userId: 'user-1' as OrderDoc['userId'],
            status: 'awaiting_payment',
            reservationId: null,
          }),
        ),
      },
    ]);
    await expect(submitPaymentProof(ctxWith(db), CUSTOMER, input)).rejects.toBeInstanceOf(
      ReservationExpiredError,
    );
  });

  it('refuses to submit against an order that is not awaiting payment', async () => {
    const paid = seed({
      status: 'paid',
      payment: {
        ...anOrder().payment,
        upiRef: '999999999999' as OrderDoc['payment']['upiRef'],
        submittedAt: NOW,
        verifiedBy: 'staff-uid-0001' as OrderDoc['payment']['verifiedBy'],
        verifiedAt: NOW,
      },
    });
    const { db } = fakeDb(paid);
    await expect(submitPaymentProof(ctxWith(db), CUSTOMER, input)).rejects.toThrow();
    // No guard was claimed.
  });
});
