import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { aProduct } from '@romp/contracts/fixtures';
import { NotFoundError } from '@romp/observability';

import { fixedClock } from '../clock';
import { ANONYMOUS, asCustomer, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';
import { paths } from '../paths';

import { addToWishlist, removeFromWishlist } from './wishlist-write';

/**
 * Unit tests for wishlist writes.
 *
 * The concern is the two guards the repository owns: the product must exist and be visible before a
 * reference is saved, and a wishlist belongs to a signed-in customer (an anonymous caller is refused
 * as a 404). Add is idempotent (a set), remove is idempotent (a delete of a known path).
 */

const NOW = new Date('2026-03-01T12:00:00.000Z');
const UID = 'cust-1';
const CUSTOMER = asCustomer(UID);

interface Converter {
  toFirestore: (v: unknown) => Record<string, unknown>;
  fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
}

/** A Firestore double supporting doc get/set/delete by path. */
function fakeDb(seed: Readonly<Record<string, Record<string, unknown>>> = {}) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(seed));

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
      get: () =>
        Promise.resolve({
          id: ref.id,
          exists: store.get(path) !== undefined,
          data: () => decode(path, store.get(path), converter),
        }),
      set: (data: unknown) => {
        store.set(
          path,
          (converter === null ? data : converter.toFirestore(data)) as Record<string, unknown>,
        );
        return Promise.resolve();
      },
      delete: () => {
        store.delete(path);
        return Promise.resolve();
      },
    };
    return ref;
  };

  const db = { doc: docRef } as unknown as Firestore;
  return { db, store };
}

function ctxWith(db: Firestore): StoreContext {
  return createStoreContext({ storeId: 'test-store', db, clock: fixedClock(NOW) });
}

describe('addToWishlist', () => {
  it('saves a product that exists and is visible', async () => {
    const { db, store } = fakeDb({
      [paths.product('wooden-blocks')]: converters.products.toFirestore(aProduct()),
    });
    await addToWishlist(ctxWith(db), CUSTOMER, 'wooden-blocks');
    expect(store.get(paths.wishlistItem(UID, 'wooden-blocks'))?.productId).toBe('wooden-blocks');
  });

  it('404s a product that does not exist', async () => {
    const { db } = fakeDb({});
    await expect(addToWishlist(ctxWith(db), CUSTOMER, 'nope')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('404s a draft product a customer cannot see', async () => {
    const { db } = fakeDb({
      [paths.product('draft')]: converters.products.toFirestore(aProduct({ status: 'draft' })),
    });
    await expect(addToWishlist(ctxWith(db), CUSTOMER, 'draft')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('refuses an anonymous caller', async () => {
    const { db } = fakeDb({
      [paths.product('wooden-blocks')]: converters.products.toFirestore(aProduct()),
    });
    await expect(addToWishlist(ctxWith(db), ANONYMOUS, 'wooden-blocks')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('removeFromWishlist', () => {
  it('removes a saved product', async () => {
    const { db, store } = fakeDb({
      [paths.wishlistItem(UID, 'wooden-blocks')]: converters.wishlist.toFirestore({
        productId: 'wooden-blocks' as never,
        addedAt: NOW,
      }),
    });
    await removeFromWishlist(ctxWith(db), CUSTOMER, 'wooden-blocks');
    expect(store.get(paths.wishlistItem(UID, 'wooden-blocks'))).toBeUndefined();
  });

  it('is a no-op for something not on the list', async () => {
    const { db } = fakeDb({});
    await expect(removeFromWishlist(ctxWith(db), CUSTOMER, 'nope')).resolves.toBeUndefined();
  });

  it('refuses an anonymous caller', async () => {
    const { db } = fakeDb({});
    await expect(removeFromWishlist(ctxWith(db), ANONYMOUS, 'x')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
