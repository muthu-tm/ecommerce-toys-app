import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { aProduct, aVariant, anInventoryRecord } from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  CartMutationError,
  addOrUpdateCartItem,
  converters,
  createStoreContext,
  mergeAnonymousCart,
  readCart,
  removeCartItem,
  setGiftWrap,
  systemClock,
} from '@romp/data';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The cart write path against real Firestore.
 *
 * `@romp/core` unit-tests the ceilings and `@romp/data` unit-tests the transaction shape; this
 * proves the wiring end to end: a mutation resolves the live variant, price and stock, creates the
 * cart with the right owner shape, refuses an over-stock quantity, and a merge folds the guest cart
 * into the user cart and deletes it.
 */

let app: App;
let ctx: StoreContext;

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `cart-write-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Seeds an active product, a variant, and an inventory record so a variant resolves. */
async function seedCatalogue(productId: string, variantId: string, available = 10): Promise<void> {
  await ctx.db
    .doc(`products/${productId}`)
    .withConverter(converters.products)
    .set(aProduct({ slug: productId as ReturnType<typeof aProduct>['slug'], status: 'active' }));
  await ctx.db
    .doc(`products/${productId}/variants/${variantId}`)
    .withConverter(converters.variants)
    .set(aVariant({ sku: variantId as ReturnType<typeof aVariant>['sku'], active: true }));
  await ctx.db
    .doc(`inventory/${variantId}`)
    .withConverter(converters.inventory)
    .set(
      anInventoryRecord({
        productId: productId as ReturnType<typeof anInventoryRecord>['productId'],
        stock: { blr: available } as ReturnType<typeof anInventoryRecord>['stock'],
        onHandTotal: available,
        reserved: 0,
        lowStockThreshold: 0,
      }),
    );
}

describe('the cart write path against Firestore', () => {
  it('adds a line, creating a user cart, and reads it back', async () => {
    const productId = uniqueId('cart-prod');
    const variantId = uniqueId('cart-var');
    await seedCatalogue(productId, variantId, 10);

    const uid = uniqueId('cart-user');
    const ref = { kind: 'user' as const, uid };

    const cart = await addOrUpdateCartItem(ctx, ref, {
      productId,
      variantId,
      qty: 3,
      mode: 'add',
      maxQtyPerLine: 20,
    });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.qty).toBe(3);

    const readBack = await readCart(ctx, ref);
    expect(readBack?.items[0]?.qty).toBe(3);
    expect(readBack?.ownerType).toBe('user');
  });

  it('refuses adding more than is available', async () => {
    const productId = uniqueId('cart-prod');
    const variantId = uniqueId('cart-var');
    await seedCatalogue(productId, variantId, 2);

    const ref = { kind: 'user' as const, uid: uniqueId('cart-user') };
    await expect(
      addOrUpdateCartItem(ctx, ref, {
        productId,
        variantId,
        qty: 5,
        mode: 'add',
        maxQtyPerLine: 20,
      }),
    ).rejects.toBeInstanceOf(CartMutationError);
  });

  it('removes a line and toggles gift wrap', async () => {
    const productId = uniqueId('cart-prod');
    const variantId = uniqueId('cart-var');
    await seedCatalogue(productId, variantId, 10);

    const ref = { kind: 'user' as const, uid: uniqueId('cart-user') };
    await addOrUpdateCartItem(ctx, ref, {
      productId,
      variantId,
      qty: 1,
      mode: 'add',
      maxQtyPerLine: 20,
    });

    const wrapped = await setGiftWrap(ctx, ref, true);
    expect(wrapped.giftWrap).toBe(true);

    const emptied = await removeCartItem(ctx, ref, variantId);
    expect(emptied.items).toHaveLength(0);
  });

  it('merges a guest cart into the user cart and deletes the guest cart', async () => {
    const productId = uniqueId('cart-prod');
    const variantId = uniqueId('cart-var');
    await seedCatalogue(productId, variantId, 10);

    const guestCartId = uniqueId('anon');
    const uid = uniqueId('cart-user');
    const guestRef = { kind: 'anonymous' as const, cartId: guestCartId };
    const userRef = { kind: 'user' as const, uid };

    await addOrUpdateCartItem(ctx, guestRef, {
      productId,
      variantId,
      qty: 2,
      mode: 'add',
      maxQtyPerLine: 20,
    });
    await addOrUpdateCartItem(ctx, userRef, {
      productId,
      variantId,
      qty: 1,
      mode: 'add',
      maxQtyPerLine: 20,
    });

    const merged = await mergeAnonymousCart(ctx, uid, guestCartId, 20);
    expect(merged.items[0]?.qty).toBe(3); // 1 + 2
    expect(await readCart(ctx, guestRef)).toBeNull();
  });
});
