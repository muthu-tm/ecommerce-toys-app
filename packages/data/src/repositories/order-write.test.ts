import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { money } from '@romp/contracts';
import type { CheckoutSettingsDoc } from '@romp/contracts';
import {
  aProduct,
  aVariant,
  anInventoryRecord,
  aWarehouse,
  anAddress,
  checkoutSettings,
} from '@romp/contracts/fixtures';
import { InsufficientStockError } from '@romp/observability';

import { fixedClock } from '../clock';
import { asCustomer, createStoreContext } from '../context';
import type { StoreContext } from '../context';
import { converters } from '../converters';

import {
  EmptyCartError,
  VariantUnavailableError,
  quoteCart,
  reserveAndPlaceOrder,
} from './order-write';

/**
 * Unit tests for the order-placement transaction.
 *
 * The totals and allocation arithmetic is `@romp/core`'s and tested there; the concurrency and
 * end-to-end integrity are proven against the emulator in `infra/tests`. Here a stateful Firestore
 * double asserts the orchestration: that placement recomputes from live prices, reserves stock,
 * mints the sequential order number and UPI payload, writes the order/reservation/events, clears the
 * cart, and refuses (writing nothing) on an empty cart, a vanished variant, or insufficient stock.
 */

const NOW = new Date('2026-03-01T09:30:00.000Z');
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
 * A transaction-capable Firestore double for order placement.
 *
 * Supports doc get, collection get (with orderBy for warehouses), collection auto-id doc(), and a
 * transaction honouring converters. Records writes/creates by path so the test can inspect what
 * landed. It does not enforce read-before-write ordering — the emulator tests do — but it applies
 * every write atomically only after the callback resolves, so a thrown refusal writes nothing.
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

  const collectionRef = (path: string) => {
    let converter: Converter | null = null;
    const orderFields: string[] = [];
    const ref = {
      path,
      withConverter: (c: Converter) => {
        converter = c;
        return ref;
      },
      get converter() {
        return converter;
      },
      orderBy: (field: string) => {
        orderFields.push(field);
        return ref;
      },
      doc: () => {
        generated += 1;
        return docRef(`${path}/generated-${String(generated)}`);
      },
      get: () => {
        const prefix = `${path}/`;
        let entries = [...store.entries()].filter(
          ([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
        );
        for (const field of orderFields) {
          entries = entries.sort(([, a], [, b]) => (a[field] as number) - (b[field] as number));
        }
        const docs = entries.map(([key, raw]) => ({
          id: key.slice(prefix.length),
          data: () => decode(key, raw, converter),
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

const SETTINGS: CheckoutSettingsDoc = checkoutSettings();

/** Seeds an active product, variant, inventory, one warehouse, an address, the counter and a cart. */
function fullSeed(
  options: { available?: number; qty?: number; cartEmpty?: boolean } = {},
): StoredDoc[] {
  const available = options.available ?? 10;
  const qty = options.qty ?? 2;
  return [
    {
      path: 'products/wooden-blocks',
      data: converters.products.toFirestore(aProduct({ status: 'active' })),
    },
    {
      path: 'products/wooden-blocks/variants/WB-240',
      data: converters.variants.toFirestore(
        aVariant({ active: true, priceMinor: money(1_29_900), mrpMinor: money(1_49_900) }),
      ),
    },
    {
      path: 'inventory/WB-240',
      data: converters.inventory.toFirestore(
        anInventoryRecord({
          stock: { blr: available } as ReturnType<typeof anInventoryRecord>['stock'],
          onHandTotal: available,
          reserved: 0,
        }),
      ),
    },
    {
      path: 'warehouses/blr',
      data: converters.warehouses.toFirestore(
        aWarehouse({
          code: 'blr' as ReturnType<typeof aWarehouse>['code'],
          active: true,
          priority: 0,
        }),
      ),
    },
    { path: 'users/user-1/addresses/addr-1', data: converters.addresses.toFirestore(anAddress()) },
    {
      path: 'counters/orderHumanId',
      data: converters.counters.toFirestore({ value: 1_000, updatedAt: NOW }),
    },
    {
      path: 'carts/user-1',
      data: converters.carts.toFirestore({
        ownerType: 'user',
        userId: 'user-1' as never,
        items: options.cartEmpty
          ? []
          : [
              {
                variantId: 'WB-240',
                productId: 'wooden-blocks',
                sku: 'WB-240',
                qty,
                priceMinorSnapshot: 1_29_900,
                nameSnapshot: 'Wooden blocks',
                variantNameSnapshot: '240 pieces',
                imagePathSnapshot: null,
                addedAt: NOW,
              } as never,
            ],
        giftWrap: false,
        updatedAt: NOW,
        expiresAt: null,
      }),
    },
  ];
}

const input = {
  uid: 'user-1',
  addressId: 'addr-1',
  deliverySpeed: 'standard' as const,
  isGift: false,
  giftMessage: null,
  contact: { email: 'a@b.com', phone: null },
};

describe('reserveAndPlaceOrder', () => {
  it('places an order, reserves stock, mints the human id and UPI payload, and clears the cart', async () => {
    const { db, store } = fakeDb(fullSeed({ available: 10, qty: 2 }));
    const result = await reserveAndPlaceOrder(ctxWith(db), CUSTOMER, input, SETTINGS, 'RMP');

    expect(result.humanId).toBe('RMP-1001');
    expect(result.status).toBe('awaiting_payment');
    expect(result.qrPayload).toContain('tn=RMP-1001');
    expect(result.qrPayload).toContain('cu=INR');
    // Totals recomputed from the live price 1_29_900 × 2.
    expect(result.amounts.subtotalMinor).toBe(2_59_800);

    // Reserved bumped, counter incremented, cart cleared.
    expect(store.get('inventory/WB-240')?.reserved).toBe(2);
    expect(store.get('counters/orderHumanId')?.value).toBe(1_001);
    expect((store.get('carts/user-1')?.items as unknown[]).length).toBe(0);
  });

  it('refuses an empty cart, writing nothing', async () => {
    const { db, store } = fakeDb(fullSeed({ cartEmpty: true }));
    await expect(
      reserveAndPlaceOrder(ctxWith(db), CUSTOMER, input, SETTINGS, 'RMP'),
    ).rejects.toBeInstanceOf(EmptyCartError);
    expect(store.get('counters/orderHumanId')?.value).toBe(1_000);
  });

  it('refuses when a cart line variant is no longer active', async () => {
    const seed = fullSeed();
    seed[1] = {
      path: 'products/wooden-blocks/variants/WB-240',
      data: converters.variants.toFirestore(aVariant({ active: false })),
    };
    const { db } = fakeDb(seed);
    await expect(
      reserveAndPlaceOrder(ctxWith(db), CUSTOMER, input, SETTINGS, 'RMP'),
    ).rejects.toBeInstanceOf(VariantUnavailableError);
  });

  it('refuses insufficient stock, reserving nothing', async () => {
    const { db, store } = fakeDb(fullSeed({ available: 1, qty: 3 }));
    await expect(
      reserveAndPlaceOrder(ctxWith(db), CUSTOMER, input, SETTINGS, 'RMP'),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(store.get('inventory/WB-240')?.reserved).toBe(0);
    expect(store.get('counters/orderHumanId')?.value).toBe(1_000);
  });

  it('records the allocation across warehouses on the order', async () => {
    const { db, store } = fakeDb(fullSeed({ available: 10, qty: 2 }));
    await reserveAndPlaceOrder(ctxWith(db), CUSTOMER, input, SETTINGS, 'RMP');
    const orderEntry = [...store.entries()].find(([key]) => key.startsWith('orders/generated-'));
    expect(orderEntry).toBeDefined();
    const order = orderEntry?.[1] as { allocation: Record<string, Record<string, number>> };
    expect(order.allocation['WB-240']).toEqual({ blr: 2 });
  });

  it('refuses when the variant has no inventory record at all', async () => {
    const seed = fullSeed().filter((doc) => !doc.path.startsWith('inventory/'));
    const { db } = fakeDb(seed);
    await expect(
      reserveAndPlaceOrder(ctxWith(db), CUSTOMER, input, SETTINGS, 'RMP'),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('refuses when stock sits only at an inactive warehouse (no active warehouse can supply it)', async () => {
    const seed = fullSeed({ available: 10, qty: 2 });
    // Deactivate the only warehouse: reserve passes on the total, but allocation finds no active
    // warehouse to fill from.
    seed[3] = {
      path: 'warehouses/blr',
      data: converters.warehouses.toFirestore(
        aWarehouse({
          code: 'blr' as ReturnType<typeof aWarehouse>['code'],
          active: false,
          priority: 0,
        }),
      ),
    };
    const { db } = fakeDb(seed);
    await expect(
      reserveAndPlaceOrder(ctxWith(db), CUSTOMER, input, SETTINGS, 'RMP'),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('snapshots a null image path when the product has no media', async () => {
    const seed = fullSeed({ available: 10, qty: 1 });
    seed[0] = {
      path: 'products/wooden-blocks',
      data: converters.products.toFirestore(aProduct({ status: 'active', media: [] })),
    };
    const { db, store } = fakeDb(seed);
    await reserveAndPlaceOrder(ctxWith(db), CUSTOMER, input, SETTINGS, 'RMP');
    const orderEntry = [...store.entries()].find(([key]) => key.startsWith('orders/generated-'));
    const order = orderEntry?.[1] as { items: { imagePath: string | null }[] };
    expect(order.items[0]?.imagePath).toBeNull();
  });

  it('applies gift wrap and express delivery to the recomputed totals', async () => {
    const seed = fullSeed({ available: 10, qty: 1 });
    // Turn gift wrap on in the seeded cart.
    seed[6] = {
      path: 'carts/user-1',
      data: converters.carts.toFirestore({
        ownerType: 'user',
        userId: 'user-1' as never,
        items: [
          {
            variantId: 'WB-240',
            productId: 'wooden-blocks',
            sku: 'WB-240',
            qty: 1,
            priceMinorSnapshot: 1_29_900,
            nameSnapshot: 'Wooden blocks',
            variantNameSnapshot: '240 pieces',
            imagePathSnapshot: null,
            addedAt: NOW,
          } as never,
        ],
        giftWrap: true,
        updatedAt: NOW,
        expiresAt: null,
      }),
    };
    const { db } = fakeDb(seed);
    const result = await reserveAndPlaceOrder(
      ctxWith(db),
      CUSTOMER,
      { ...input, deliverySpeed: 'express', isGift: true, giftMessage: 'Happy birthday' },
      SETTINGS,
      'RMP',
    );
    expect(result.amounts.giftWrapMinor).toBeGreaterThan(0);
    expect(result.amounts.shippingMinor).toBeGreaterThan(0);
  });
});

describe('quoteCart', () => {
  it('prices the cart at the live variant price and recomputes the totals, reserving nothing', async () => {
    const { db, store } = fakeDb(fullSeed({ available: 10, qty: 2 }));
    const quote = await quoteCart(ctxWith(db), 'user-1', 'standard', SETTINGS);

    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]?.unitPriceMinor).toBe(1_29_900);
    expect(quote.lines[0]?.lineTotalMinor).toBe(2_59_800);
    expect(quote.giftWrap).toBe(false);
    expect(quote.totals.subtotalMinor).toBe(2_59_800);
    // A quote is a read: it touches no inventory and mints no order number.
    expect(store.get('inventory/WB-240')?.reserved).toBe(0);
    expect(store.get('counters/orderHumanId')?.value).toBe(1_000);
  });

  it('carries the cart gift-wrap flag and delivery speed into the totals', async () => {
    const seed = fullSeed({ available: 10, qty: 1 });
    seed[6] = {
      path: 'carts/user-1',
      data: converters.carts.toFirestore({
        ownerType: 'user',
        userId: 'user-1' as never,
        items: [
          {
            variantId: 'WB-240',
            productId: 'wooden-blocks',
            sku: 'WB-240',
            qty: 1,
            priceMinorSnapshot: 1_29_900,
            nameSnapshot: 'Wooden blocks',
            variantNameSnapshot: '240 pieces',
            imagePathSnapshot: null,
            addedAt: NOW,
          } as never,
        ],
        giftWrap: true,
        updatedAt: NOW,
        expiresAt: null,
      }),
    };
    const { db } = fakeDb(seed);
    const quote = await quoteCart(ctxWith(db), 'user-1', 'express', SETTINGS);
    expect(quote.giftWrap).toBe(true);
    expect(quote.totals.giftWrapMinor).toBeGreaterThan(0);
    expect(quote.totals.shippingMinor).toBeGreaterThan(0);
  });

  it('refuses to quote an empty cart', async () => {
    const { db } = fakeDb(fullSeed({ cartEmpty: true }));
    await expect(quoteCart(ctxWith(db), 'user-1', 'standard', SETTINGS)).rejects.toBeInstanceOf(
      EmptyCartError,
    );
  });

  it('refuses to quote a cart whose variant is no longer active', async () => {
    const seed = fullSeed();
    seed[1] = {
      path: 'products/wooden-blocks/variants/WB-240',
      data: converters.variants.toFirestore(aVariant({ active: false })),
    };
    const { db } = fakeDb(seed);
    await expect(quoteCart(ctxWith(db), 'user-1', 'standard', SETTINGS)).rejects.toBeInstanceOf(
      VariantUnavailableError,
    );
  });
});
