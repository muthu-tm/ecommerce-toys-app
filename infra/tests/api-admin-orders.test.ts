import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '@romp/api/app';
import type { RompApp } from '@romp/api/app';
import type { IssueRefundResponse, OrderDoc, OrderView, ReservationDoc } from '@romp/contracts';
import { anInventoryRecord, anOrder, aReservation } from '@romp/contracts/fixtures';
import { converters, createStoreContext, systemClock } from '@romp/data';
import type { StoreContext } from '@romp/data';
import { createSilentLogger } from '@romp/observability';

import { DEMO_PROJECT_ID, requireEmulatorEndpoint } from './helpers/emulator';

/**
 * The admin order-and-money API against real Auth and Firestore emulators.
 *
 * The route tests cover the guards and validation; the `@romp/data` suite covers the write repos.
 * This covers the wiring through real operator tokens: an owner verifies a payment (order paid,
 * reservation committed), rejects one, and issues a refund; a staff token is refused on refunds.
 */

let adminApp: App;
let app: RompApp;
let ctx: StoreContext;
let ownerAuth = '';
let staffAuth = '';

const TOTAL = 2_90_976;
const CONFIG = {
  storeId: 'test-store',
  brandNames: ['Test Store'],
  defaultPhoneRegion: 'IN',
  corsOrigins: ['https://admin.test'],
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
  if (body.idToken === undefined) throw new Error(`Sign-in failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

const uniqueId = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** Mints an operator with the given role and returns a bearer header. */
async function operator(role: 'owner' | 'staff'): Promise<string> {
  const auth = getAuth(adminApp);
  const email = `${role}.${uniqueId('a')}@example.com`;
  const password = 'velvet thunder maple orbit river';
  const user = await auth.createUser({ email, password });
  await auth.setCustomUserClaims(user.uid, { role });
  return `Bearer ${await signIn(email, password)}`;
}

/** Seeds a pending_verification order, its active reservation, and inventory holding 2 units. */
async function seedPending(): Promise<{
  orderId: string;
  variantId: string;
  reservationId: string;
}> {
  const orderId = uniqueId('order');
  const reservationId = uniqueId('res');
  const variantId = uniqueId('v');
  await ctx.db
    .doc(`orders/${orderId}`)
    .withConverter(converters.orders)
    .set(
      anOrder({
        status: 'pending_verification',
        reservationId: reservationId as OrderDoc['reservationId'],
        items: [
          {
            ...anOrder().items[0]!,
            variantId: variantId as OrderDoc['items'][number]['variantId'],
          },
        ],
        allocation: { [variantId]: { blr: 2 } } as unknown as OrderDoc['allocation'],
        payment: {
          ...anOrder().payment,
          upiRef: '412398765432' as OrderDoc['payment']['upiRef'],
          submittedAt: new Date(),
        },
      }),
    );
  await ctx.db
    .doc(`reservations/${reservationId}`)
    .withConverter(converters.reservations)
    .set(
      aReservation({
        orderId: orderId as ReservationDoc['orderId'],
        status: 'active',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        resolvedAt: null,
        items: [{ variantId: variantId as never, qty: 2, allocation: { blr: 2 } as never }],
      }),
    );
  await ctx.db
    .doc(`inventory/${variantId}`)
    .withConverter(converters.inventory)
    .set(
      anInventoryRecord({
        stock: { blr: 10 } as ReturnType<typeof anInventoryRecord>['stock'],
        onHandTotal: 10,
        reserved: 2,
      }),
    );
  return { orderId, variantId, reservationId };
}

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: DEMO_PROJECT_ID },
    `api-admin-orders-${String(Date.now())}`,
  );
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
  ownerAuth = await operator('owner');
  staffAuth = await operator('staff');
});

afterAll(async () => {
  await app.close();
  await deleteApp(adminApp);
});

describe('POST /v1/admin/orders/:id/verify-payment', () => {
  it('commits stock and returns the paid order on an exact match', async () => {
    const { orderId, variantId, reservationId } = await seedPending();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/verify-payment`,
      headers: { authorization: ownerAuth },
      payload: { paidAmountMinor: TOTAL },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<OrderView>().status).toBe('paid');

    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.onHandTotal).toBe(8);
    expect(inventory?.reserved).toBe(0);
    const reservation = (
      await ctx.db.doc(`reservations/${reservationId}`).withConverter(converters.reservations).get()
    ).data();
    expect(reservation?.status).toBe('committed');
  });

  it('409s a short payment', async () => {
    const { orderId } = await seedPending();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/verify-payment`,
      headers: { authorization: ownerAuth },
      payload: { paidAmountMinor: TOTAL - 100 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('PAYMENT_AMOUNT_MISMATCH');
  });
});

describe('POST /v1/admin/orders/:id/reject-payment', () => {
  it('rejects the order with a reason', async () => {
    const { orderId } = await seedPending();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/reject-payment`,
      headers: { authorization: ownerAuth },
      payload: { reason: 'No matching payment.' },
    });
    expect(response.statusCode).toBe(200);
    const order = response.json<OrderView>();
    expect(order.status).toBe('payment_rejected');
    expect(order.payment.rejectionReason).toBe('No matching payment.');
  });
});

describe('GET /v1/admin/orders', () => {
  it('returns a page of orders to an operator', async () => {
    await seedPending();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/orders?limit=5',
      headers: { authorization: ownerAuth },
    });
    expect(response.statusCode).toBe(200);
    const page = response.json<{ items: OrderView[]; nextCursor: string | null }>();
    expect(Array.isArray(page.items)).toBe(true);
    expect('nextCursor' in page).toBe(true);
  });

  it('filters by payment status', async () => {
    await seedPending();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/orders?status=pending_verification&limit=100',
      headers: { authorization: ownerAuth },
    });
    expect(response.statusCode).toBe(200);
    const page = response.json<{ items: OrderView[] }>();
    expect(page.items.every((o) => o.status === 'pending_verification')).toBe(true);
  });

  it('finds one order by its human number', async () => {
    const { orderId } = await seedPending();
    const seeded = (
      await ctx.db.doc(`orders/${orderId}`).withConverter(converters.orders).get()
    ).data();
    const humanId = seeded?.humanId ?? '';

    const response = await app.inject({
      method: 'GET',
      url: `/v1/admin/orders?humanId=${encodeURIComponent(humanId)}`,
      headers: { authorization: ownerAuth },
    });
    expect(response.statusCode).toBe(200);
    const page = response.json<{ items: OrderView[]; nextCursor: string | null }>();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.humanId).toBe(humanId);
    expect(page.nextCursor).toBeNull();
  });
});

describe('POST /v1/admin/orders/:id/fulfilment', () => {
  /** Verifies an order to `paid` so fulfilment can begin. */
  async function paidOrderId(): Promise<string> {
    const { orderId } = await seedPending();
    await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/verify-payment`,
      headers: { authorization: ownerAuth },
      payload: { paidAmountMinor: TOTAL },
    });
    return orderId;
  }

  it('packs then ships a paid order with a carrier and tracking', async () => {
    const orderId = await paidOrderId();

    const packed = await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/fulfilment`,
      headers: { authorization: ownerAuth },
      payload: { status: 'packed' },
    });
    expect(packed.statusCode).toBe(200);
    expect(packed.json<OrderView>().fulfilment.status).toBe('packed');

    const shipped = await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/fulfilment`,
      headers: { authorization: ownerAuth },
      payload: { status: 'shipped', carrier: 'Delhivery', trackingNo: 'DL123456' },
    });
    expect(shipped.statusCode).toBe(200);
    const order = shipped.json<OrderView>();
    expect(order.fulfilment.status).toBe('shipped');
    expect(order.fulfilment.carrier).toBe('Delhivery');
  });

  it('409s packing an order whose payment is not verified', async () => {
    const { orderId } = await seedPending();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/fulfilment`,
      headers: { authorization: ownerAuth },
      payload: { status: 'packed' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('POST /v1/admin/orders/:id/cancel', () => {
  it('cancels a held order and moves both machines to cancelled', async () => {
    const { orderId, variantId } = await seedPending();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/cancel`,
      headers: { authorization: ownerAuth },
      payload: { reason: 'Customer changed their mind.' },
    });
    expect(response.statusCode).toBe(200);
    const order = response.json<OrderView>();
    expect(order.status).toBe('cancelled');
    expect(order.fulfilment.status).toBe('cancelled');

    // The held units were released back.
    const inventory = (
      await ctx.db.doc(`inventory/${variantId}`).withConverter(converters.inventory).get()
    ).data();
    expect(inventory?.reserved).toBe(0);
  });
});

describe('GET /v1/admin/analytics/daily', () => {
  it('returns the rollup rows for a range to an operator', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/daily?from=2026-03-01&to=2026-03-31',
      headers: { authorization: ownerAuth },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ days: unknown[] }>();
    expect(Array.isArray(body.days)).toBe(true);
  });
});

describe('POST /v1/admin/refunds', () => {
  /** Verifies an order to `paid` so it can be refunded. */
  async function paidOrder(): Promise<string> {
    const { orderId } = await seedPending();
    await app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${orderId}/verify-payment`,
      headers: { authorization: ownerAuth },
      payload: { paidAmountMinor: TOTAL },
    });
    return orderId;
  }

  it('lets an owner issue a full refund', async () => {
    const orderId = await paidOrder();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/refunds',
      headers: { authorization: ownerAuth },
      payload: {
        orderId,
        mode: 'full',
        amountMinor: TOTAL,
        reason: 'customer_cancelled',
        note: null,
        outwardUpiRef: null,
        restock: false,
      },
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<IssueRefundResponse>();
    expect(result.status).toBe('refunded');
    expect(result.refundedMinor).toBe(TOTAL);
  });

  it('404s a staff caller — refunds require the owner claim', async () => {
    const orderId = await paidOrder();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/refunds',
      headers: { authorization: staffAuth },
      payload: {
        orderId,
        mode: 'full',
        amountMinor: TOTAL,
        reason: 'customer_cancelled',
        note: null,
        outwardUpiRef: null,
        restock: false,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe('NOT_FOUND');
  });
});
