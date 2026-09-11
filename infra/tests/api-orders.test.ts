import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '@romp/api/app';
import type { RompApp } from '@romp/api/app';
import { money } from '@romp/contracts';
import type {
  CheckoutQuoteResponse,
  OrderView,
  PlaceOrderResponse,
  SubmitPaymentProofResponse,
} from '@romp/contracts';
import {
  aProduct,
  aUser,
  aVariant,
  anAddress,
  anInventoryRecord,
  aWarehouse,
  checkoutSettings,
} from '@romp/contracts/fixtures';
import { converters, createStoreContext, systemClock } from '@romp/data';
import type { StoreContext } from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import { DEMO_PROJECT_ID, requireEmulatorEndpoint } from './helpers/emulator';

/**
 * The checkout-quote and order-placement API against real Auth and Firestore emulators.
 *
 * The route tests cover the guards and validation; the `@romp/data` suite covers the write repo and
 * the concurrency property. This proves the wiring end to end through a real signed-in token: a
 * quote prices the caller's cart, placement reserves stock and returns the UPI payload, the
 * idempotency key makes a retry return the original order rather than reserving twice, and the read
 * route returns the caller's own order and 404s a foreign one.
 */

let adminApp: App;
let app: RompApp;
let ctx: StoreContext;

const CONFIG = {
  storeId: 'test-store',
  brandNames: ['Test Store'],
  defaultPhoneRegion: 'IN',
  corsOrigins: ['https://shop.test'],
  cartCookieSecret: 'emulator-cart-secret',
};

function authEmulatorHost(): string {
  const { host, port } = requireEmulatorEndpoint('FIREBASE_AUTH_EMULATOR_HOST');
  return `http://${host}:${String(port)}`;
}

async function signIn(loginEmail: string, password: string): Promise<string> {
  const response = await fetch(
    `${authEmulatorHost()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken?: string };
  if (body.idToken === undefined)
    throw new Error(`Emulator sign-in failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Seeds the checkout settings, a warehouse and the order-number counter once. */
async function seedStore(): Promise<void> {
  await ctx.db
    .doc('settings/checkout')
    .withConverter(converters.checkoutSettings)
    .set(checkoutSettings({ reservationTtlMinutes: 30 }));
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
    .doc('counters/orderHumanId')
    .withConverter(converters.counters)
    .set({ value: 1_000, updatedAt: new Date() });
}

/** Seeds an active product + variant + inventory for a checkout. */
async function seedCatalogue(productId: string, variantId: string, available = 10): Promise<void> {
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
}

/** Creates a signed-in customer with a profile, an address and a cart holding one variant. */
async function makeCustomer(
  productId: string,
  variantId: string,
  qty: number,
): Promise<{ uid: string; token: string }> {
  const email = `order.${uniqueId('c')}@example.com`;
  const password = 'velvet thunder maple orbit river';
  const user = await getAuth(adminApp).createUser({ email, password });
  const uid = user.uid;
  const token = await signIn(email, password);

  await ctx.db
    .doc(`users/${uid}`)
    .withConverter(converters.users)
    .set(aUser({ email: email as ReturnType<typeof aUser>['email'] }));
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

  return { uid, token };
}

beforeAll(async () => {
  adminApp = initializeApp({ projectId: DEMO_PROJECT_ID }, `api-orders-${String(Date.now())}`);
  ctx = createStoreContext({
    storeId: CONFIG.storeId,
    db: getFirestore(adminApp),
    clock: systemClock,
  });
  app = await buildApp({
    logger: createSilentLogger(),
    auth: getAuth(adminApp),
    context: ctx,
    config: CONFIG,
  });
  await app.ready();
  await seedStore();
});

afterAll(async () => {
  await app.close();
  await deleteApp(adminApp);
});

describe('POST /v1/checkout/quote', () => {
  it('prices the caller’s cart from live variant prices', async () => {
    const productId = uniqueId('p');
    const variantId = uniqueId('v');
    await seedCatalogue(productId, variantId, 10);
    const { token } = await makeCustomer(productId, variantId, 2);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/checkout/quote',
      headers: { authorization: `Bearer ${token}` },
      payload: { deliverySpeed: 'standard' },
    });
    expect(response.statusCode).toBe(200);
    const quote = response.json<CheckoutQuoteResponse>();
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]?.lineTotalMinor).toBe(2_59_800);
    expect(quote.subtotalMinor).toBe(2_59_800);
    expect(quote.totalMinor).toBe(
      quote.subtotalMinor + quote.giftWrapMinor + quote.shippingMinor + quote.taxMinor,
    );
  });
});

describe('POST /v1/orders', () => {
  it('places an order, reserves stock, returns the UPI payload, and the owner can read it', async () => {
    const productId = uniqueId('p');
    const variantId = uniqueId('v');
    await seedCatalogue(productId, variantId, 10);
    const { uid, token } = await makeCustomer(productId, variantId, 2);

    const placed = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': uniqueId('key') },
      payload: { addressId: 'addr', deliverySpeed: 'standard', isGift: false, giftMessage: null },
    });
    expect(placed.statusCode).toBe(201);
    const order = placed.json<PlaceOrderResponse>();
    expect(order.status).toBe('awaiting_payment');
    expect(order.qrPayload).toContain('cu=INR');
    expect(order.qrPayload).toContain(`tn=${order.humanId}`);
    expect(order.amounts.subtotalMinor).toBe(2_59_800);

    // Stock reserved and cart cleared.
    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.reserved).toBe(2);
    const cart = (await ctx.db.doc(`carts/${uid}`).withConverter(converters.carts).get()).data();
    expect(cart?.items).toHaveLength(0);

    // The owner can read the order back.
    const read = await app.inject({
      method: 'GET',
      url: `/v1/orders/${order.orderId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
    const view = read.json<OrderView>();
    expect(view.humanId).toBe(order.humanId);
    expect(view.items).toHaveLength(1);
    expect(view.payment.qrPayload).toBe(order.qrPayload);
  });

  it('replays the original order for a repeated idempotency key — no double reservation', async () => {
    const productId = uniqueId('p');
    const variantId = uniqueId('v');
    await seedCatalogue(productId, variantId, 10);
    const { token } = await makeCustomer(productId, variantId, 1);
    const key = uniqueId('key');
    const payload = {
      addressId: 'addr',
      deliverySpeed: 'standard' as const,
      isGift: false,
      giftMessage: null,
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    // The same order id both times.
    expect(second.json<PlaceOrderResponse>().orderId).toBe(
      first.json<PlaceOrderResponse>().orderId,
    );

    // Reserved exactly once despite two calls.
    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.reserved).toBe(1);
  });

  it('404s an order the caller does not own', async () => {
    const productId = uniqueId('p');
    const variantId = uniqueId('v');
    await seedCatalogue(productId, variantId, 10);
    const owner = await makeCustomer(productId, variantId, 1);
    const placed = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { authorization: `Bearer ${owner.token}`, 'idempotency-key': uniqueId('key') },
      payload: { addressId: 'addr', deliverySpeed: 'standard', isGift: false, giftMessage: null },
    });
    const orderId = placed.json<PlaceOrderResponse>().orderId;

    // A different signed-in customer.
    const other = await makeCustomer(uniqueId('p'), uniqueId('v'), 1);
    const read = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(read.statusCode).toBe(404);
    expect(read.json<{ code: string }>().code).toBe('NOT_FOUND');
  });
});

describe('POST /v1/orders/:id/payment-proof', () => {
  /** Places an order and returns its id + the owner's token. */
  async function placeOrder(): Promise<{ orderId: string; token: string }> {
    const productId = uniqueId('p');
    const variantId = uniqueId('v');
    await seedCatalogue(productId, variantId, 10);
    const { token } = await makeCustomer(productId, variantId, 1);
    const placed = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': uniqueId('key') },
      payload: { addressId: 'addr', deliverySpeed: 'standard', isGift: false, giftMessage: null },
    });
    return { orderId: placed.json<PlaceOrderResponse>().orderId, token };
  }

  it('records the reference, moves the order to pending_verification, and reads back', async () => {
    const { orderId, token } = await placeOrder();
    const utr = uniqueId('UTR').replaceAll('-', '').toUpperCase().slice(0, 20);

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/payment-proof`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': uniqueId('key') },
      payload: { upiRef: utr, screenshotPath: null },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json<SubmitPaymentProofResponse>().status).toBe('pending_verification');

    const read = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const order = read.json<OrderView>();
    expect(order.status).toBe('pending_verification');
    expect(order.payment.upiRef).toBe(utr);
  });

  it('409s a reference already claimed by another order', async () => {
    const first = await placeOrder();
    const second = await placeOrder();
    const utr = uniqueId('UTR').replaceAll('-', '').toUpperCase().slice(0, 20);

    await app.inject({
      method: 'POST',
      url: `/v1/orders/${first.orderId}/payment-proof`,
      headers: { authorization: `Bearer ${first.token}`, 'idempotency-key': uniqueId('key') },
      payload: { upiRef: utr, screenshotPath: null },
    });
    const dup = await app.inject({
      method: 'POST',
      url: `/v1/orders/${second.orderId}/payment-proof`,
      headers: { authorization: `Bearer ${second.token}`, 'idempotency-key': uniqueId('key') },
      payload: { upiRef: utr, screenshotPath: null },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json<{ code: string }>().code).toBe('DUPLICATE_PAYMENT_REFERENCE');
  });
});
