import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import type { OrderDoc, ProductDoc, Rating, ReviewDoc } from '@romp/contracts';
import { RatingSchema } from '@romp/contracts';
import { anOrder, aProduct, aReview } from '@romp/contracts/fixtures';
import {
  InvalidStateTransitionError,
  NotFoundError,
  ValidationFailedError,
} from '@romp/observability';

import { fixedClock } from '../clock';
import { asCustomer, asOperator, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import { moderateReview, submitReview } from './review-write';

/**
 * Unit tests for review writes.
 *
 * A query-capable Firestore double asserts what the API owns: a review is `pending` on submit with
 * the verified-purchase badge derived from the caller's paid orders, one review per product, and a
 * moderation decision that follows the review state machine and records who and when. The
 * `review.submitted`/`published`/`rejected` events land on the spine in the same transaction.
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');
const UID = 'cust-1';
const CUSTOMER = asCustomer(UID);
const STAFF = asOperator('staff-1', 'staff');
const PRODUCT_ID = 'wooden-blocks';
const AUTHOR = 'Asha M.';
const rating = (n: number): Rating => RatingSchema.parse(n);

interface StoredDoc {
  readonly path: string;
  data: Record<string, unknown>;
}

interface Converter {
  toFirestore: (v: unknown) => Record<string, unknown>;
  fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
}

interface Filter {
  readonly field: string;
  readonly op: string;
  readonly value: unknown;
}

/**
 * A Firestore double supporting doc get/set/delete, collection auto-id `doc()`, transaction
 * get/set, and a query chain (`where`/`orderBy`/`limit`/`get`) that filters the seeded documents.
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

  const fieldValue = (data: Record<string, unknown>, field: string): unknown =>
    field.split('.').reduce<unknown>((acc, key) => {
      if (acc !== null && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, data);

  const matches = (data: Record<string, unknown>, filters: readonly Filter[]): boolean =>
    filters.every((f) => {
      const v = fieldValue(data, f.field);
      if (f.op === '==') return v === f.value;
      if (f.op === 'in') return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
      return true;
    });

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
      delete: () => {
        store.delete(path);
        return Promise.resolve();
      },
    };
    return ref;
  };

  const collectionRef = (path: string) => {
    let converter: Converter | null = null;
    const filters: Filter[] = [];
    const query = {
      path,
      withConverter: (c: Converter) => {
        converter = c;
        return query;
      },
      get converter() {
        return converter;
      },
      where: (field: string, op: string, value: unknown) => {
        filters.push({ field, op, value });
        return query;
      },
      orderBy: () => query,
      limit: () => query,
      doc: () => {
        generated += 1;
        const d = docRef(`${path}/generated-${String(generated)}`);
        return converter === null ? d : d.withConverter(converter);
      },
      get: () => {
        const docs = [...store.entries()]
          .filter(
            ([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
          )
          .filter(([, raw]) => matches(raw, filters))
          .map(([key, raw]) => ({
            id: key.split('/').at(-1) ?? '',
            ref: docRef(key).withConverter(converter!),
            data: () => decode(key, raw, converter),
          }));
        return Promise.resolve({ empty: docs.length === 0, size: docs.length, docs });
      },
    };
    return query;
  };

  interface Ref {
    path: string;
    converter: Converter | null;
  }

  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: Ref) => Promise<unknown>;
      set: (ref: Ref, data: unknown) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    const staged: { path: string; data: Record<string, unknown> }[] = [];
    const tx = {
      get: (ref: Ref & { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: Ref, data: unknown) => {
        staged.push({
          path: ref.path,
          data: (ref.converter === null ? data : ref.converter.toFirestore(data)) as Record<
            string,
            unknown
          >,
        });
      },
    };
    const result = await fn(tx as never);
    for (const w of staged) store.set(w.path, w.data);
    return result;
  };

  const db = { doc: docRef, collection: collectionRef, runTransaction } as unknown as Firestore;
  return { db, store };
}

function ctxWith(db: Firestore): StoreContext {
  return createStoreContext({ storeId: 'test-store', db, clock: fixedClock(NOW) });
}

function seedProduct(overrides: Partial<ProductDoc> = {}): StoredDoc {
  return {
    path: `products/${PRODUCT_ID}`,
    data: converters.products.toFirestore(aProduct({ status: 'active', ...overrides })),
  };
}

function seedPaidOrder(id: string, productId: string): StoredDoc {
  const order = anOrder({
    userId: UID as OrderDoc['userId'],
    status: 'paid',
    payment: { ...anOrder().payment, verifiedBy: 'staff-1' as never, verifiedAt: NOW },
    items: [{ ...anOrder().items[0]!, productId: productId as never }],
  });
  return { path: `orders/${id}`, data: converters.orders.toFirestore(order) };
}

function seedReview(id: string, overrides: Partial<ReviewDoc> = {}): StoredDoc {
  return {
    path: `reviews/${id}`,
    data: converters.reviews.toFirestore(
      aReview({ productId: PRODUCT_ID as never, userId: UID as never, ...overrides }),
    ),
  };
}

const input = { productId: PRODUCT_ID, rating: rating(4), title: 'Great', body: 'Well made.' };

function eventCount(store: Map<string, Record<string, unknown>>): number {
  return [...store.keys()].filter((key) => key.startsWith('events/')).length;
}

function eventType(store: Map<string, Record<string, unknown>>): string | undefined {
  const entry = [...store.entries()].find(([key]) => key.startsWith('events/'));
  return entry?.[1].type as string | undefined;
}

describe('submitReview', () => {
  it('writes a pending review and appends review.submitted', async () => {
    const { db, store } = fakeDb([seedProduct()]);
    const { id } = await submitReview(ctxWith(db), CUSTOMER, UID, input, AUTHOR);

    const created = store.get(`reviews/${id}`);
    expect(created?.status).toBe('pending');
    expect(created?.authorName).toBe(AUTHOR);
    expect(eventCount(store)).toBe(1);
    expect(eventType(store)).toBe('review.submitted');
  });

  it('flags a verified purchase when a paid order contains the product', async () => {
    const { db, store } = fakeDb([seedProduct(), seedPaidOrder('order-1', PRODUCT_ID)]);
    const { id } = await submitReview(ctxWith(db), CUSTOMER, UID, input, AUTHOR);

    const created = store.get(`reviews/${id}`);
    expect(created?.verifiedPurchase).toBe(true);
    expect(created?.orderId).toBe('order-1');
  });

  it('leaves the badge off and the order null with no matching purchase', async () => {
    const { db, store } = fakeDb([seedProduct(), seedPaidOrder('order-1', 'something-else')]);
    const { id } = await submitReview(ctxWith(db), CUSTOMER, UID, input, AUTHOR);

    const created = store.get(`reviews/${id}`);
    expect(created?.verifiedPurchase).toBe(false);
    expect(created?.orderId).toBeNull();
  });

  it('refuses a second review while one occupies the slot', async () => {
    const { db } = fakeDb([seedProduct(), seedReview('r1', { status: 'pending' })]);
    await expect(submitReview(ctxWith(db), CUSTOMER, UID, input, AUTHOR)).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it('allows a new review after an earlier one was rejected', async () => {
    const { db, store } = fakeDb([seedProduct(), seedReview('r1', { status: 'rejected' })]);
    const { id } = await submitReview(ctxWith(db), CUSTOMER, UID, input, AUTHOR);
    expect(store.get(`reviews/${id}`)?.status).toBe('pending');
  });

  it('404s a review of a missing product', async () => {
    const { db } = fakeDb([]);
    await expect(submitReview(ctxWith(db), CUSTOMER, UID, input, AUTHOR)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('refuses a foreign account', async () => {
    const { db } = fakeDb([seedProduct()]);
    await expect(
      submitReview(ctxWith(db), asCustomer('other'), UID, input, AUTHOR),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('moderateReview', () => {
  it('publishes a pending review and records the moderator', async () => {
    const { db, store } = fakeDb([
      seedProduct(),
      seedReview('r1', {
        status: 'pending',
        moderatedBy: null,
        moderatedAt: null,
        rejectionReason: null,
      }),
    ]);
    await moderateReview(ctxWith(db), STAFF, 'r1', { action: 'publish' });

    const updated = store.get('reviews/r1');
    expect(updated?.status).toBe('published');
    expect(updated?.moderatedBy).toBe('staff-1');
    expect(eventType(store)).toBe('review.published');
  });

  it('rejects a pending review and records the reason', async () => {
    const { db, store } = fakeDb([
      seedProduct(),
      seedReview('r1', {
        status: 'pending',
        moderatedBy: null,
        moderatedAt: null,
        rejectionReason: null,
      }),
    ]);
    await moderateReview(ctxWith(db), STAFF, 'r1', { action: 'reject', reason: 'Off-topic' });

    const updated = store.get('reviews/r1');
    expect(updated?.status).toBe('rejected');
    expect(updated?.rejectionReason).toBe('Off-topic');
    expect(eventType(store)).toBe('review.rejected');
  });

  it('refuses an illegal transition from a rejected review', async () => {
    const { db } = fakeDb([
      seedProduct(),
      seedReview('r1', { status: 'rejected', rejectionReason: 'Off-topic' }),
    ]);
    await expect(
      moderateReview(ctxWith(db), STAFF, 'r1', { action: 'reject', reason: 'again' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('refuses a non-staff moderator', async () => {
    const { db } = fakeDb([seedProduct(), seedReview('r1', { status: 'pending' })]);
    await expect(
      moderateReview(ctxWith(db), CUSTOMER, 'r1', { action: 'publish' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s a missing review', async () => {
    const { db } = fakeDb([seedProduct()]);
    await expect(
      moderateReview(ctxWith(db), STAFF, 'nope', { action: 'publish' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
