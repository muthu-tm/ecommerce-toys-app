import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { money } from '@romp/contracts';
import type { CheckoutSettingsDoc } from '@romp/contracts';
import {
  aProduct,
  aVariant,
  anAddress,
  anInventoryRecord,
  aWarehouse,
  checkoutSettings,
} from '@romp/contracts/fixtures';
import type { StoreContext } from '@romp/data';
import {
  EmptyCartError,
  asCustomer,
  converters,
  createStoreContext,
  findOrder,
  reserveAndPlaceOrder,
  systemClock,
} from '@romp/data';
import { InsufficientStockError } from '@romp/observability';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The order-placement transaction against real Firestore.
 *
 * `@romp/core` unit-tests the totals and `@romp/data` unit-tests the orchestration; this proves the
 * property a fake cannot: that N parallel checkouts for a single remaining unit serialise on the
 * inventory record and exactly one succeeds. It also proves the whole transaction commits together
 * — order, reservation, counter, cart-clear — end to end.
 */

let app: App;
let ctx: StoreContext;
const SETTINGS: CheckoutSettingsDoc = checkoutSettings({ reservationTtlMinutes: 30 });

beforeAll(() => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `order-write-${String(Date.now())}`);
  ctx = createStoreContext({ storeId: 'test-store', db: getFirestore(app), clock: systemClock });
});

afterAll(async () => {
  await deleteApp(app);
});

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Seeds a product, variant, inventory, warehouse, address, counter and cart for one uid. */
async function seed(options: {
  uid: string;
  productId: string;
  variantId: string;
  available: number;
  qty: number;
}): Promise<void> {
  const { uid, productId, variantId, available, qty } = options;
  await ctx.db
    .doc(`products/${productId}`)
    .withConverter(converters.products)
    .set(aProduct({ slug: productId as ReturnType<typeof aProduct>['slug'], status: 'active' }));
  await ctx.db
    .doc(`products/${productId}/variants/${variantId}`)
    .withConverter(converters.variants)
    .set(
      aVariant({
        sku: variantId as ReturnType<typeof aVariant>['sku'],
        active: true,
        priceMinor: money(1_29_900),
        mrpMinor: money(1_49_900),
      }),
    );
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
  await ctx.db
    .doc('warehouses/blr')
    .withConverter(converters.warehouses)
    .set(
      aWarehouse({
        code: 'blr' as ReturnType<typeof aWarehouse>['code'],
        active: true,
        priority: 0,
      }),
    );
  await ctx.db
    .doc(`users/${uid}/addresses/addr`)
    .withConverter(converters.addresses)
    .set(anAddress());
  await ctx.db
    .doc('counters/orderHumanId')
    .withConverter(converters.counters)
    .set({ value: 1_000, updatedAt: new Date() });
  await ctx.db
    .doc(`carts/${uid}`)
    .withConverter(converters.carts)
    .set({
      ownerType: 'user',
      userId: uid as never,
      items: [
        {
          variantId,
          productId,
          sku: variantId,
          qty,
          priceMinorSnapshot: money(1_29_900),
          nameSnapshot: 'Wooden blocks',
          variantNameSnapshot: '240',
          imagePathSnapshot: null,
          addedAt: new Date(),
        } as never,
      ],
      giftWrap: false,
      updatedAt: new Date(),
      expiresAt: null,
    });
}

const inputFor = (uid: string) => ({
  uid,
  addressId: 'addr',
  deliverySpeed: 'standard' as const,
  isGift: false,
  giftMessage: null,
  contact: { email: 'a@b.com', phone: null },
});

describe('reserveAndPlaceOrder against Firestore', () => {
  it('places an order end to end: order + reservation + counter + cleared cart', async () => {
    const uid = uniqueId('u');
    const variantId = uniqueId('v');
    await seed({ uid, productId: uniqueId('p'), variantId, available: 10, qty: 2 });

    const result = await reserveAndPlaceOrder(ctx, asCustomer(uid), inputFor(uid), SETTINGS, 'RMP');
    expect(result.status).toBe('awaiting_payment');
    expect(result.humanId).toBe('RMP-1001');
    expect(result.qrPayload).toContain('tn=RMP-1001');

    // The order is readable by its owner.
    const order = await findOrder(ctx, asCustomer(uid), result.orderId);
    expect(order.humanId).toBe('RMP-1001');
    expect(order.reservationId).not.toBeNull();

    // Stock reserved, cart cleared.
    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.reserved).toBe(2);
    const cart = (await ctx.db.doc(`carts/${uid}`).withConverter(converters.carts).get()).data();
    expect(cart?.items).toHaveLength(0);

    // A reservation document exists and is active.
    expect(order.reservationId).not.toBeNull();
    const reservation = (
      await ctx.db
        .doc(`reservations/${String(order.reservationId)}`)
        .withConverter(converters.reservations)
        .get()
    ).data();
    expect(reservation?.status).toBe('active');
  });

  it('refuses an empty cart', async () => {
    const uid = uniqueId('u');
    await seed({ uid, productId: uniqueId('p'), variantId: uniqueId('v'), available: 5, qty: 1 });
    // Empty the cart.
    await ctx.db
      .doc(`carts/${uid}`)
      .withConverter(converters.carts)
      .set({
        ownerType: 'user',
        userId: uid as never,
        items: [],
        giftWrap: false,
        updatedAt: new Date(),
        expiresAt: null,
      });
    await expect(
      reserveAndPlaceOrder(ctx, asCustomer(uid), inputFor(uid), SETTINGS, 'RMP'),
    ).rejects.toBeInstanceOf(EmptyCartError);
  });

  it('serialises N parallel checkouts for one remaining unit — exactly one succeeds', async () => {
    // One unit of stock; five customers each with a cart for it.
    const productId = uniqueId('p');
    const variantId = uniqueId('v');
    const uids = Array.from({ length: 5 }, () => uniqueId('u'));
    await seed({ uid: uids[0]!, productId, variantId, available: 1, qty: 1 });
    // Give the other four their own carts + addresses for the same variant.
    for (const uid of uids.slice(1)) {
      await ctx.db
        .doc(`users/${uid}/addresses/addr`)
        .withConverter(converters.addresses)
        .set(anAddress());
      await ctx.db
        .doc(`carts/${uid}`)
        .withConverter(converters.carts)
        .set({
          ownerType: 'user',
          userId: uid as never,
          items: [
            {
              variantId,
              productId,
              sku: variantId,
              qty: 1,
              priceMinorSnapshot: money(1_29_900),
              nameSnapshot: 'Wooden blocks',
              variantNameSnapshot: '240',
              imagePathSnapshot: null,
              addedAt: new Date(),
            } as never,
          ],
          giftWrap: false,
          updatedAt: new Date(),
          expiresAt: null,
        });
    }

    const results = await Promise.allSettled(
      uids.map((uid) => reserveAndPlaceOrder(ctx, asCustomer(uid), inputFor(uid), SETTINGS, 'RMP')),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(InsufficientStockError);
    }

    // The one unit is reserved, not oversold.
    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.reserved).toBe(1);
    expect((inventory?.onHandTotal ?? 0) - (inventory?.reserved ?? 0)).toBe(0);
  });
});
