import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { money } from '@romp/contracts';
import type { CartItem } from '@romp/contracts';
import { aProduct, aVariant, anInventoryRecord } from '@romp/contracts/fixtures';

import { fixedClock } from '../clock';
import { createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import {
  CartMutationError,
  addOrUpdateCartItem,
  mergeAnonymousCart,
  readCart,
  removeCartItem,
  setGiftWrap,
} from './cart-write';
import type { CartRef } from './cart-write';

/**
 * Unit tests for the cart write repository.
 *
 * The ceiling arithmetic and the price refresh are `@romp/core`'s and tested there; this asserts
 * the transactional orchestration a real database shows: that a mutation resolves the variant and
 * its availability from a fresh read, creates the cart on first write with the right owner shape,
 * refuses through a `CartMutationError`, and that a merge folds and deletes the guest cart.
 * End-to-end against Firestore is in `infra/tests`.
 */

const NOW = new Date('2026-03-01T09:30:00.000Z');
const USER: CartRef = { kind: 'user', uid: 'user-1' };
const GUEST: CartRef = { kind: 'anonymous', cartId: 'anon-abc' };

interface StoredDoc {
  readonly path: string;
  data: Record<string, unknown>;
}

interface Converter {
  toFirestore: (v: unknown) => Record<string, unknown>;
  fromFirestore: (s: { id: string; data: () => unknown }) => unknown;
}

/** A transaction-capable Firestore double: doc get/set/delete, converters, records writes. */
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

  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: DocRef) => Promise<{ data: () => unknown }>;
      set: (ref: DocRef, data: unknown) => void;
      delete: (ref: DocRef) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    const staged: { path: string; data: Record<string, unknown> }[] = [];
    const stagedDeletes: string[] = [];
    const tx = {
      get: (ref: DocRef) => {
        const raw = store.get(ref.path);
        return Promise.resolve({ data: () => decode(ref.path, raw, ref.converter) });
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
      delete: (ref: DocRef) => {
        stagedDeletes.push(ref.path);
      },
    };
    const result = await fn(tx);
    for (const w of staged) store.set(w.path, w.data);
    for (const p of stagedDeletes) store.delete(p);
    return result;
  };

  const db = { doc: docRef, runTransaction } as unknown as Firestore;
  return { db, store };
}

function ctxWith(db: Firestore): StoreContext {
  return createStoreContext({ storeId: 'test-store', db, clock: fixedClock(NOW) });
}

/** Seeds a product (active), a variant, and an inventory record so a variant resolves. */
function catalogueSeed(
  productId: string,
  variantId: string,
  overrides: { available?: number; active?: boolean; priceMinor?: number } = {},
): StoredDoc[] {
  return [
    {
      path: `products/${productId}`,
      data: converters.products.toFirestore(
        aProduct({
          slug: productId as ReturnType<typeof aProduct>['slug'],
          status: 'active',
        }),
      ),
    },
    {
      path: `products/${productId}/variants/${variantId}`,
      data: converters.variants.toFirestore(
        aVariant({
          sku: variantId as ReturnType<typeof aVariant>['sku'],
          active: overrides.active ?? true,
          priceMinor: money(overrides.priceMinor ?? 1_29_900),
          mrpMinor: money(Math.max(overrides.priceMinor ?? 1_29_900, 1_49_900)),
        }),
      ),
    },
    {
      path: `inventory/${variantId}`,
      data: converters.inventory.toFirestore(
        anInventoryRecord({
          productId: productId as ReturnType<typeof anInventoryRecord>['productId'],
          stock: { blr: overrides.available ?? 10 } as ReturnType<
            typeof anInventoryRecord
          >['stock'],
          onHandTotal: overrides.available ?? 10,
          reserved: 0,
        }),
      ),
    },
  ];
}

describe('addOrUpdateCartItem', () => {
  it('creates a user cart on first add, with the right owner shape', async () => {
    const { db, store } = fakeDb(catalogueSeed('wooden-blocks', 'WB-240'));
    const cart = await addOrUpdateCartItem(ctxWith(db), USER, {
      productId: 'wooden-blocks',
      variantId: 'WB-240',
      qty: 2,
      mode: 'add',
      maxQtyPerLine: 20,
    });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.qty).toBe(2);

    const stored = store.get('carts/user-1');
    expect(stored?.ownerType).toBe('user');
    expect(stored?.userId).toBe('user-1');
    expect(stored?.expiresAt).toBeNull();
  });

  it('creates a guest cart with an expiry', async () => {
    const { db, store } = fakeDb(catalogueSeed('wooden-blocks', 'WB-240'));
    await addOrUpdateCartItem(ctxWith(db), GUEST, {
      productId: 'wooden-blocks',
      variantId: 'WB-240',
      qty: 1,
      mode: 'add',
      maxQtyPerLine: 20,
    });
    const stored = store.get('carts/anon-abc');
    expect(stored?.ownerType).toBe('anonymous');
    expect(stored?.userId).toBeNull();
    expect(stored?.expiresAt).not.toBeNull();
  });

  it('refuses a variant that does not resolve (unavailable)', async () => {
    const { db } = fakeDb(catalogueSeed('wooden-blocks', 'WB-240', { active: false }));
    await expect(
      addOrUpdateCartItem(ctxWith(db), USER, {
        productId: 'wooden-blocks',
        variantId: 'WB-240',
        qty: 1,
        mode: 'add',
        maxQtyPerLine: 20,
      }),
    ).rejects.toBeInstanceOf(CartMutationError);
  });

  it('refuses a quantity above available stock', async () => {
    const { db } = fakeDb(catalogueSeed('wooden-blocks', 'WB-240', { available: 3 }));
    await expect(
      addOrUpdateCartItem(ctxWith(db), USER, {
        productId: 'wooden-blocks',
        variantId: 'WB-240',
        qty: 5,
        mode: 'add',
        maxQtyPerLine: 20,
      }),
    ).rejects.toMatchObject({ reason: 'qty_exceeds_available' });
  });

  it('refreshes the price snapshot from the current variant', async () => {
    const { db } = fakeDb(catalogueSeed('wooden-blocks', 'WB-240', { priceMinor: 3_00_000 }));
    const cart = await addOrUpdateCartItem(ctxWith(db), USER, {
      productId: 'wooden-blocks',
      variantId: 'WB-240',
      qty: 1,
      mode: 'add',
      maxQtyPerLine: 20,
    });
    expect(cart.items[0]?.priceMinorSnapshot).toBe(3_00_000);
  });

  it("set replaces the line quantity rather than summing, and snapshots the product's cover image", async () => {
    const { db } = fakeDb(catalogueSeed('wooden-blocks', 'WB-240'));
    await addOrUpdateCartItem(ctxWith(db), USER, {
      productId: 'wooden-blocks',
      variantId: 'WB-240',
      qty: 4,
      mode: 'add',
      maxQtyPerLine: 20,
    });
    const cart = await addOrUpdateCartItem(ctxWith(db), USER, {
      productId: 'wooden-blocks',
      variantId: 'WB-240',
      qty: 2,
      mode: 'set',
      maxQtyPerLine: 20,
    });
    expect(cart.items[0]?.qty).toBe(2);
    // aProduct's fixture media has a cover; the snapshot carries its path, not a null.
    expect(cart.items[0]?.imagePathSnapshot).not.toBeNull();
  });

  it('refuses a quantity above the per-line ceiling regardless of stock', async () => {
    const { db } = fakeDb(catalogueSeed('wooden-blocks', 'WB-240', { available: 100 }));
    await expect(
      addOrUpdateCartItem(ctxWith(db), USER, {
        productId: 'wooden-blocks',
        variantId: 'WB-240',
        qty: 25,
        mode: 'set',
        maxQtyPerLine: 20,
      }),
    ).rejects.toMatchObject({ reason: 'qty_exceeds_max' });
  });

  it('snapshots a null cover when the product has no media', async () => {
    const seed = catalogueSeed('wooden-blocks', 'WB-240');
    // Overwrite the product with one that has no media.
    seed[0] = {
      path: 'products/wooden-blocks',
      data: converters.products.toFirestore(aProduct({ status: 'active', media: [] })),
    };
    const { db } = fakeDb(seed);
    const cart = await addOrUpdateCartItem(ctxWith(db), USER, {
      productId: 'wooden-blocks',
      variantId: 'WB-240',
      qty: 1,
      mode: 'add',
      maxQtyPerLine: 20,
    });
    expect(cart.items[0]?.imagePathSnapshot).toBeNull();
  });

  it('treats a variant with no inventory record as out of stock', async () => {
    const seed = catalogueSeed('wooden-blocks', 'WB-240');
    // Drop the inventory doc so availability resolves to zero.
    const withoutInventory = seed.filter((doc) => !doc.path.startsWith('inventory/'));
    const { db } = fakeDb(withoutInventory);
    await expect(
      addOrUpdateCartItem(ctxWith(db), USER, {
        productId: 'wooden-blocks',
        variantId: 'WB-240',
        qty: 1,
        mode: 'add',
        maxQtyPerLine: 20,
      }),
    ).rejects.toMatchObject({ reason: 'variant_unavailable' });
  });

  it('refuses a product that does not exist', async () => {
    const { db } = fakeDb();
    await expect(
      addOrUpdateCartItem(ctxWith(db), USER, {
        productId: 'gone',
        variantId: 'WB-240',
        qty: 1,
        mode: 'add',
        maxQtyPerLine: 20,
      }),
    ).rejects.toMatchObject({ reason: 'variant_unavailable' });
  });
});

describe('removeCartItem', () => {
  it('drops the line and needs no variant read', async () => {
    const seed = catalogueSeed('wooden-blocks', 'WB-240');
    const { db } = fakeDb(seed);
    await addOrUpdateCartItem(ctxWith(db), USER, {
      productId: 'wooden-blocks',
      variantId: 'WB-240',
      qty: 2,
      mode: 'add',
      maxQtyPerLine: 20,
    });
    const cart = await removeCartItem(ctxWith(db), USER, 'WB-240');
    expect(cart.items).toHaveLength(0);
  });

  it('is a no-op on an absent cart', async () => {
    const { db } = fakeDb();
    const cart = await removeCartItem(ctxWith(db), USER, 'WB-240');
    expect(cart.items).toHaveLength(0);
  });
});

describe('setGiftWrap', () => {
  it('toggles the flag', async () => {
    const { db } = fakeDb();
    const cart = await setGiftWrap(ctxWith(db), USER, true);
    expect(cart.giftWrap).toBe(true);
  });
});

describe('readCart', () => {
  it('returns null when no cart exists', async () => {
    const { db } = fakeDb();
    expect(await readCart(ctxWith(db), USER)).toBeNull();
  });
});

describe('mergeAnonymousCart', () => {
  it('folds the guest cart into the user cart and deletes the guest cart', async () => {
    const line = (variantId: string, qty: number) =>
      ({
        variantId,
        productId: 'wooden-blocks',
        sku: variantId,
        qty,
        priceMinorSnapshot: 1_29_900,
        nameSnapshot: 'Wooden blocks',
        variantNameSnapshot: '240',
        imagePathSnapshot: null,
        addedAt: NOW,
      }) as unknown as CartItem;
    const { db, store } = fakeDb([
      {
        path: 'carts/user-1',
        data: converters.carts.toFirestore({
          ownerType: 'user',
          userId: 'user-1' as never,
          items: [line('v1', 1)],
          giftWrap: false,
          updatedAt: NOW,
          expiresAt: null,
        }),
      },
      {
        path: 'carts/anon-abc',
        data: converters.carts.toFirestore({
          ownerType: 'anonymous',
          userId: null,
          items: [line('v1', 2), line('v2', 1)],
          giftWrap: true,
          updatedAt: NOW,
          expiresAt: new Date('2026-04-01T00:00:00.000Z'),
        }),
      },
      {
        path: 'inventory/v1',
        data: converters.inventory.toFirestore(
          anInventoryRecord({
            stock: { blr: 10 } as ReturnType<typeof anInventoryRecord>['stock'],
            onHandTotal: 10,
            reserved: 0,
          }),
        ),
      },
      {
        path: 'inventory/v2',
        data: converters.inventory.toFirestore(
          anInventoryRecord({
            stock: { blr: 10 } as ReturnType<typeof anInventoryRecord>['stock'],
            onHandTotal: 10,
            reserved: 0,
          }),
        ),
      },
    ]);

    const merged = await mergeAnonymousCart(ctxWith(db), 'user-1', 'anon-abc', 20);
    // v1: 1 + 2 = 3; v2: 1.
    expect(merged.items.find((i) => i.variantId === 'v1')?.qty).toBe(3);
    expect(merged.items.find((i) => i.variantId === 'v2')?.qty).toBe(1);
    // Gift wrap OR'd from the guest.
    expect(merged.giftWrap).toBe(true);
    // Guest cart deleted.
    expect(store.has('carts/anon-abc')).toBe(false);
  });

  it('is a no-op returning the user cart when the guest cart is absent', async () => {
    const { db } = fakeDb();
    const merged = await mergeAnonymousCart(ctxWith(db), 'user-1', 'anon-gone', 20);
    expect(merged.items).toHaveLength(0);
    expect(merged.ownerType).toBe('user');
  });

  it('creates the user cart from a guest cart when the user had none', async () => {
    const line = (variantId: string, qty: number) =>
      ({
        variantId,
        productId: 'wooden-blocks',
        sku: variantId,
        qty,
        priceMinorSnapshot: 1_29_900,
        nameSnapshot: 'Wooden blocks',
        variantNameSnapshot: '240',
        imagePathSnapshot: null,
        addedAt: NOW,
      }) as unknown as CartItem;
    const { db, store } = fakeDb([
      {
        path: 'carts/anon-abc',
        data: converters.carts.toFirestore({
          ownerType: 'anonymous',
          userId: null,
          items: [line('v1', 2)],
          giftWrap: false,
          updatedAt: NOW,
          expiresAt: new Date('2026-04-01T00:00:00.000Z'),
        }),
      },
      {
        path: 'inventory/v1',
        data: converters.inventory.toFirestore(
          anInventoryRecord({
            stock: { blr: 10 } as ReturnType<typeof anInventoryRecord>['stock'],
            onHandTotal: 10,
            reserved: 0,
          }),
        ),
      },
    ]);

    const merged = await mergeAnonymousCart(ctxWith(db), 'user-1', 'anon-abc', 20);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]?.qty).toBe(2);
    expect(merged.ownerType).toBe('user');
    expect(merged.userId).toBe('user-1');
    expect(store.has('carts/anon-abc')).toBe(false);
  });
});
