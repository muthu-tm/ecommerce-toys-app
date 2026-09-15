import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Caller, StoreContext } from '@romp/data';
import {
  ANONYMOUS,
  asCustomer,
  asOperator,
  asSystem,
  COLLECTIONS,
  converters,
  createStoreContext,
  fixedClock,
  findActiveReservationForOrder,
  findCategoryBySlug,
  firestoreSearchPort,
  findOrder,
  findOrderByHumanId,
  findProductById,
  findProductBySlug,
  findProductsByIds,
  getAvailability,
  getCheckoutSettings,
  getUser,
  listAllocatableWarehouses,
  listCategories,
  listExpiredReservations,
  listLedgerForVariant,
  listLowStock,
  listNavCategories,
  listNotifications,
  listOrderEvents,
  listOrdersForUser,
  listPublishedReviews,
  listVariantOptions,
  listVariants,
  listVerificationQueue,
  listWarehouses,
  oldestExpiredReservationAgeMs,
  paths,
  reconcileVariantStock,
} from '@romp/data';
import { applySeedPlan, buildSeedPlan } from '@romp/data/seed';
import { NotFoundError } from '@romp/observability';
import { loadCatalogueSeed, loadStoreConfig } from '@romp/store-config/loader';

import { DEMO_PROJECT_ID } from './helpers/emulator';

/**
 * The repository layer against real Firestore.
 *
 * `@romp/data`'s own tests assert *how* each repository asks — that the ownership filter
 * is in the query rather than applied after the read, and that refusal is a 404. Those are
 * properties a real database cannot distinguish.
 *
 * This suite asserts the half a recorder cannot: that each query is **well-formed** and
 * returns the **right documents** — that a status filter really excludes the seeded draft,
 * that an ownership filter really returns one order rather than two, that a nested field
 * path like `fulfilment.status` is spelled the way Firestore expects.
 *
 * It runs against the seeded ROMP catalogue, so the fixtures are the same data
 * `pnpm seed` produces rather than a parallel set that could drift from it.
 *
 * **What this suite does not prove: index coverage.** The Firestore emulator creates any
 * index a query needs, on demand. Production does not — it fails the query. So a query
 * shape with no entry in `infra/firestore.indexes.json` passes here and throws in
 * production, on the page that needed it. `tests/indexes.test.ts` covers that gap
 * separately, by checking the declared index set against the shapes the code builds.
 */

const CUSTOMER_UID = 'customer-uid-0001';
const OTHER_UID = 'customer-uid-0002';

const CUSTOMER: Caller = asCustomer(CUSTOMER_UID);
const OTHER: Caller = asCustomer(OTHER_UID);
const STAFF: Caller = asOperator('staff-uid-0001', 'staff');
const SYSTEM: Caller = asSystem('integration suite');

const NOW = new Date('2026-03-01T09:30:00.000Z');

let app: App;
let ctx: StoreContext;

beforeAll(async () => {
  app = initializeApp({ projectId: DEMO_PROJECT_ID }, `repositories-${String(Date.now())}`);
  const db = getFirestore(app);
  ctx = createStoreContext({ storeId: 'romp', db, clock: fixedClock(NOW) });

  const config = await loadStoreConfig('romp');
  const catalogue = await loadCatalogueSeed('romp', config);

  // Start from a clean slate so counts are assertable, then seed the real catalogue.
  for (const collection of [
    COLLECTIONS.products,
    COLLECTIONS.categories,
    COLLECTIONS.warehouses,
    COLLECTIONS.inventory,
    COLLECTIONS.inventoryLedger,
    COLLECTIONS.settings,
    COLLECTIONS.counters,
    COLLECTIONS.orders,
    COLLECTIONS.users,
    COLLECTIONS.reviews,
    COLLECTIONS.notifications,
    COLLECTIONS.reservations,
  ]) {
    await db.recursiveDelete(db.collection(collection));
  }

  await applySeedPlan(
    db,
    buildSeedPlan({ storeId: 'romp', config, catalogue, clock: fixedClock(NOW) }),
  );

  // User-scoped fixtures the seed does not write, added through the Admin SDK because
  // that is how the API will write them.
  await db
    .doc(paths.user(CUSTOMER_UID))
    .withConverter(converters.users)
    .set({
      displayName: 'Asha Menon',
      primaryIdentifierType: 'email',
      email: 'asha@example.com' as never,
      phone: '+919845021174' as never,
      orderCount: 1,
      lifetimeValueMinor: 100_000 as never,
      lastOrderAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      deletionReason: null,
    });

  const order = {
    humanId: 'RMP-1001' as never,
    userId: CUSTOMER_UID as never,
    contact: { email: 'asha@example.com' as never, phone: '+919845021174' as never },
    status: 'pending_verification' as const,
    fulfilment: {
      status: 'unfulfilled' as const,
      carrier: null,
      trackingNo: null,
      packedAt: null,
      shippedAt: null,
      deliveredAt: null,
      holdReason: null,
    },
    items: [
      {
        productId: 'beechwood-stacking-rings' as never,
        variantId: 'KDU-STK-NAT' as never,
        sku: 'KDU-STK-NAT' as never,
        name: 'Beechwood stacking rings',
        variantName: 'Natural oil finish',
        imagePath: null,
        unitPriceMinor: 89_900 as never,
        qty: 1,
        lineTotalMinor: 89_900 as never,
      },
    ],
    amounts: {
      subtotalMinor: 89_900 as never,
      giftWrapMinor: 0 as never,
      shippingMinor: 0 as never,
      taxMinor: 16_182 as never,
      totalMinor: 106_082 as never,
      refundedMinor: 0 as never,
    },
    shippingAddress: {
      recipientName: 'Asha Menon',
      line1: '12 Palm Grove',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      phone: '+919845021174',
    },
    deliverySpeed: 'standard' as const,
    isGift: false,
    giftMessage: null,
    payment: {
      method: 'upi' as const,
      upiRef: '412398765432' as never,
      screenshotPath: null,
      qrPayload: 'upi://pay?pa=romp.store@okhdfcbank&am=1060.82',
      submittedAt: NOW,
      verifiedBy: null,
      verifiedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
    reservationId: 'res-1' as never,
    allocation: { 'KDU-STK-NAT': { blr: 1 } } as never,
    createdAt: NOW,
    updatedAt: NOW,
  };

  await db.doc(paths.order('order-1')).withConverter(converters.orders).set(order);
  await db
    .doc(paths.order('order-2'))
    .withConverter(converters.orders)
    .set({ ...order, humanId: 'RMP-1002' as never, userId: OTHER_UID as never });

  await db
    .doc(paths.orderEvent('order-1', 'ev-1'))
    .withConverter(converters.orderEvents)
    .set({
      orderId: 'order-1' as never,
      type: 'order.created',
      actorId: CUSTOMER_UID as never,
      actorRole: 'customer',
      payload: {},
      at: NOW,
    });

  // An expired reservation, so the sweeper query has something to find.
  await db
    .doc(paths.reservation('res-1'))
    .withConverter(converters.reservations)
    .set({
      orderId: 'order-1' as never,
      items: [{ variantId: 'KDU-STK-NAT' as never, qty: 1, allocation: { blr: 1 } as never }],
      status: 'active',
      createdAt: new Date('2026-03-01T08:30:00.000Z'),
      expiresAt: new Date('2026-03-01T09:00:00.000Z'),
      resolvedAt: null,
    });

  await db
    .doc(paths.review('review-1'))
    .withConverter(converters.reviews)
    .set({
      productId: 'beechwood-stacking-rings' as never,
      userId: CUSTOMER_UID as never,
      authorName: 'Asha M.',
      rating: 5 as never,
      title: 'Sturdy',
      body: 'Still standing.',
      status: 'published',
      verifiedPurchase: true,
      orderId: 'order-1' as never,
      moderatedBy: 'staff-uid-0001' as never,
      moderatedAt: NOW,
      rejectionReason: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

  await db
    .doc(paths.notification('n-1'))
    .withConverter(converters.notifications)
    .set({
      eventId: 'ev-1' as never,
      audience: 'user',
      userId: CUSTOMER_UID as never,
      type: 'order_placed',
      title: 'Order RMP-1001 placed',
      body: 'Pay within 30 minutes.',
      link: '/account/orders/order-1',
      readAt: null,
      readBy: {},
      createdAt: NOW,
      expiresAt: new Date('2026-04-01T00:00:00.000Z'),
    });
}, 120_000);

afterAll(async () => {
  await deleteApp(app);
});

describe('catalogue reads', () => {
  it('finds a seeded product by slug', async () => {
    const product = await findProductBySlug(ctx, ANONYMOUS, 'beechwood-stacking-rings');

    expect(product?.name).toBe('Beechwood stacking rings');
    // Read through the converter, so the document also just passed its full schema.
    expect(product?.createdAt).toBeInstanceOf(Date);
  });

  it('hides the seeded draft product from the public', async () => {
    // `shadow-theatre-kit` is seeded as a draft precisely so this is testable against real
    // data rather than against a fixture.
    expect(await findProductBySlug(ctx, ANONYMOUS, 'shadow-theatre-kit')).toBeNull();
    expect(await findProductBySlug(ctx, CUSTOMER, 'shadow-theatre-kit')).toBeNull();
    expect(await findProductBySlug(ctx, STAFF, 'shadow-theatre-kit')).not.toBeNull();
  });

  it('finds a product by ID', async () => {
    expect(await findProductById(ctx, ANONYMOUS, 'beechwood-stacking-rings')).not.toBeNull();
  });

  it('reads several products in one round trip', async () => {
    const products = await findProductsByIds(ctx, ANONYMOUS, [
      'beechwood-stacking-rings',
      'gear-machine-builder',
      'shadow-theatre-kit',
    ]);

    // The draft is dropped for a public caller.
    expect(products).toHaveLength(2);
  });

  it('lists variants ordered by price', async () => {
    const variants = await listVariants(ctx, ANONYMOUS, 'gear-machine-builder');

    expect(variants).toHaveLength(3);
    const prices = variants.map((variant) => variant.priceMinor);
    expect([...prices]).toEqual([...prices].sort((left, right) => left - right));
  });

  it('derives availability for a product detail page', async () => {
    const options = await listVariantOptions(ctx, ANONYMOUS, 'balance-board-outdoor');
    const charcoal = options.find((option) => option.sku === 'CHO-BAL-CHR');
    const natural = options.find((option) => option.sku === 'CHO-BAL-NAT');

    // Seeded with no stock anywhere, so the out-of-stock path is exercised by real data.
    expect(charcoal?.inStock).toBe(false);
    expect(natural?.inStock).toBe(true);
    expect(charcoal).not.toHaveProperty('available');
  });

  it('lists categories and the nav subset', async () => {
    const all = await listCategories(ctx);
    const nav = await listNavCategories(ctx);

    expect(all.length).toBeGreaterThan(nav.length);
    expect(nav.every((category) => category.showInNav)).toBe(true);
  });

  it('finds a category by slug', async () => {
    expect((await findCategoryBySlug(ctx, 'sensory'))?.parentId).toBe('wooden');
  });

  it('reads the seeded checkout settings', async () => {
    const settings = await getCheckoutSettings(ctx);

    expect(settings?.reservationTtlMinutes).toBe(30);
  });
});

describe('warehouse reads', () => {
  it('refuses a customer', async () => {
    await expect(listWarehouses(ctx, CUSTOMER)).rejects.toThrow(NotFoundError);
  });

  it('returns both seeded warehouses to staff, in priority order', async () => {
    const warehouses = await listWarehouses(ctx, STAFF);

    expect(warehouses.map((warehouse) => warehouse.code)).toEqual(['blr', 'del']);
  });

  it('returns only allocatable warehouses to the allocator', async () => {
    const allocatable = await listAllocatableWarehouses(ctx, SYSTEM);

    expect(allocatable.every((warehouse) => warehouse.active)).toBe(true);
  });
});

describe('ownership, against real documents', () => {
  it('returns an order to its owner', async () => {
    expect((await findOrder(ctx, CUSTOMER, 'order-1')).humanId).toBe('RMP-1001');
  });

  it('yields not-found for a foreign uid', async () => {
    // The claim `SECURITY.md § 9` makes about server reads: a foreign uid yields
    // not-found, because the Admin SDK will happily return the document otherwise.
    await expect(findOrder(ctx, OTHER, 'order-1')).rejects.toThrow(NotFoundError);
  });

  it('yields the same error for an order that does not exist', async () => {
    const foreign = await findOrder(ctx, OTHER, 'order-1').catch((error: unknown) => error);
    const absent = await findOrder(ctx, CUSTOMER, 'no-such-order').catch((error: unknown) => error);

    expect(foreign).toBeInstanceOf(NotFoundError);
    expect(absent).toBeInstanceOf(NotFoundError);
    expect((foreign as NotFoundError).message).toBe((absent as NotFoundError).message);
  });

  it('lets staff read any order', async () => {
    expect(await findOrder(ctx, STAFF, 'order-2')).toBeDefined();
  });

  it('returns only the caller own orders from a history query', async () => {
    const own = await listOrdersForUser(ctx, CUSTOMER, CUSTOMER_UID);

    expect(own).toHaveLength(1);
    expect(own[0]?.userId).toBe(CUSTOMER_UID);
  });

  it('refuses a foreign history', async () => {
    await expect(listOrdersForUser(ctx, CUSTOMER, OTHER_UID)).rejects.toThrow(NotFoundError);
  });

  it('reads a user record for its owner and refuses it to others', async () => {
    expect((await getUser(ctx, CUSTOMER, CUSTOMER_UID)).displayName).toBe('Asha Menon');
    await expect(getUser(ctx, OTHER, CUSTOMER_UID)).rejects.toThrow(NotFoundError);
  });

  it('gates an order audit trail on the parent order', async () => {
    expect(await listOrderEvents(ctx, CUSTOMER, 'order-1')).toHaveLength(1);
    await expect(listOrderEvents(ctx, OTHER, 'order-1')).rejects.toThrow(NotFoundError);
  });
});

describe('staff queries', () => {
  it('runs the verification queue', async () => {
    const queue = await listVerificationQueue(ctx, STAFF);

    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((order) => order.status === 'pending_verification')).toBe(true);
  });

  it('finds an order by its customer-facing number', async () => {
    expect((await findOrderByHumanId(ctx, STAFF, 'RMP-1001'))?.id).toBe('order-1');
  });

  it('refuses that lookup to a customer', async () => {
    await expect(findOrderByHumanId(ctx, CUSTOMER, 'RMP-1001')).rejects.toThrow(NotFoundError);
  });

  it('runs the low-stock report', async () => {
    const low = await listLowStock(ctx, STAFF);

    // `TBY-GER-160M` is seeded below the threshold on purpose.
    expect(low.map((record) => record.id)).toContain('TBY-GER-160M');
  });

  it('runs the sweeper query and measures backlog age', async () => {
    const expired = await listExpiredReservations(ctx, SYSTEM);

    expect(expired.map((reservation) => reservation.id)).toContain('res-1');
    // Thirty minutes past expiry, from the fixed clock.
    expect(await oldestExpiredReservationAgeMs(ctx, SYSTEM)).toBe(30 * 60 * 1_000);
  });

  it('finds the active reservation for an order', async () => {
    expect((await findActiveReservationForOrder(ctx, SYSTEM, 'order-1'))?.id).toBe('res-1');
  });

  it('reads the ledger for a variant', async () => {
    const entries = await listLedgerForVariant(ctx, STAFF, 'KDU-STK-NAT');

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.reason === 'seed')).toBe(true);
  });

  it('reconciles the seeded ledger against the seeded balance', async () => {
    // The invariant the reconciliation runbook stands on, checked against what the seed
    // actually wrote rather than against a plan.
    const result = await reconcileVariantStock(ctx, STAFF, 'KDU-STK-NAT');

    expect(result.balanced).toBe(true);
    expect(result.ledgerByWarehouse).toEqual({ blr: 24, del: 16 });
  });
});

describe('availability', () => {
  it('withholds counts from a customer and gives them to staff', async () => {
    const [forCustomer] = await getAvailability(ctx, CUSTOMER, ['KDU-STK-NAT']);
    const [forStaff] = await getAvailability(ctx, STAFF, ['KDU-STK-NAT']);

    expect(forCustomer?.inStock).toBe(true);
    expect(forCustomer?.available).toBeNull();
    expect(forStaff?.available).toBe(40);
  });

  it('reports a variant with no inventory record as out of stock', async () => {
    const [availability] = await getAvailability(ctx, CUSTOMER, ['NO-SUCH-SKU']);

    expect(availability?.inStock).toBe(false);
  });
});

describe('reviews and notifications', () => {
  it('serves published reviews publicly', async () => {
    const reviews = await listPublishedReviews(ctx, 'beechwood-stacking-rings');

    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.status).toBe('published');
  });

  it('gives a customer their own notification feed', async () => {
    const feed = await listNotifications(ctx, CUSTOMER);

    expect(feed).toHaveLength(1);
    expect(feed[0]?.userId).toBe(CUSTOMER_UID);
  });

  it('filters unread customer notifications on an explicit null', async () => {
    // Which only works because `readAt` is written as null rather than omitted.
    expect(await listNotifications(ctx, CUSTOMER, { unreadOnly: true })).toHaveLength(1);
  });

  it('gives a customer nothing from the staff audience', async () => {
    const feed = await listNotifications(ctx, STAFF);

    expect(feed.every((notification) => notification.audience === 'admin')).toBe(true);
  });
});

/**
 * The search adapter, end to end.
 *
 * `@romp/data` asserts the clauses the adapter builds; this asserts that those clauses
 * return the right products from the real catalogue the seed wrote. The two together are
 * what make the `SearchPort` trustworthy: one checks the question, the other the answer.
 */
describe('search against the seeded catalogue', () => {
  it('returns active products and excludes the draft', async () => {
    const page = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, { limit: 50 });
    const slugs = page.items.map((item) => item.slug);

    expect(slugs).toContain('beechwood-stacking-rings');
    expect(slugs).not.toContain('shadow-theatre-kit');
  });

  it('includes the draft for staff', async () => {
    const page = await firestoreSearchPort.searchProducts(ctx, STAFF, { limit: 50 });

    expect(page.items.map((item) => item.slug)).toContain('shadow-theatre-kit');
  });

  it('filters by category', async () => {
    const page = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
      categorySlugs: ['jigsaws'],
    });

    expect(page.items.map((item) => item.slug)).toEqual(['city-map-jigsaw-500']);
  });

  it('filters by several categories at once', async () => {
    const page = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
      categorySlugs: ['jigsaws', 'books'],
      limit: 50,
    });

    expect(page.items.map((item) => item.categorySlug).sort()).toEqual(['books', 'jigsaws']);
  });

  it('filters by age band', async () => {
    const page = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
      ageBands: ['0-2'],
      limit: 50,
    });

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.ageBand === '0-2')).toBe(true);
  });

  it('sorts by price, ascending and descending', async () => {
    const cheapest = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
      sort: 'price_asc',
      limit: 50,
    });
    const dearest = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
      sort: 'price_desc',
      limit: 50,
    });

    const ascending = cheapest.items.map((item) => item.priceFromMinor);
    expect([...ascending]).toEqual([...ascending].sort((left, right) => left - right));
    expect(dearest.items[0]?.priceFromMinor).toBe(ascending.at(-1));
  });

  it('filters by price band when sorted by price', async () => {
    const page = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
      price: { minMinor: 100_000, maxMinor: 200_000 },
      sort: 'price_asc',
      limit: 50,
    });

    expect(page.items.length).toBeGreaterThan(0);
    expect(
      page.items.every((item) => item.priceFromMinor >= 100_000 && item.priceFromMinor <= 200_000),
    ).toBe(true);
  });

  it('finds products by a name prefix', async () => {
    const page = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, { text: 'beech' });

    expect(page.items.map((item) => item.slug)).toContain('beechwood-stacking-rings');
  });

  it('finds nothing for a misspelling, which is the documented weak point', async () => {
    // ADR-0002 is explicit about this: a customer typing `helicoptor` finds nothing in
    // v1.0. Asserted so the limitation is visible rather than discovered.
    const page = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, { text: 'beechwoud' });

    expect(page.items).toEqual([]);
  });

  it('pages with a cursor, without repeating or skipping', async () => {
    const first = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
      sort: 'price_asc',
      limit: 3,
    });
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) return;

    const second = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
      sort: 'price_asc',
      limit: 3,
      cursor: first.nextCursor,
    });

    const firstSlugs = new Set(first.items.map((item) => item.slug));
    expect(second.items.every((item) => !firstSlugs.has(item.slug))).toBe(true);

    // And the pages join up in order, which is what the document-ID tiebreaker is for.
    const lastOfFirst = first.items.at(-1)?.priceFromMinor ?? 0;
    expect(second.items.every((item) => item.priceFromMinor >= lastOfFirst)).toBe(true);
  });

  it('walks the whole catalogue in pages without loss', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 20; page += 1) {
      const result = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
        sort: 'price_asc',
        limit: 2,
        cursor: cursor,
      });
      seen.push(...result.items.map((item) => item.slug));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }

    // Every active product, exactly once.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain('beechwood-stacking-rings');
    expect(seen).not.toContain('shadow-theatre-kit');
  });

  it('filters to in-stock products', async () => {
    const page = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, {
      inStockOnly: true,
      limit: 50,
    });

    expect(page.items.every((item) => item.inStock)).toBe(true);
  });

  it('projects a card without the fields a card does not render', async () => {
    const page = await firestoreSearchPort.searchProducts(ctx, ANONYMOUS, { limit: 1 });
    const [item] = page.items;

    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('description');
    expect(item).not.toHaveProperty('searchTokens');
    // The seed ships development placeholder artwork, so a card carries a cover — a Storage
    // object path with no blurhash yet (the resize Function has not run). It is a card
    // projection, so it keeps only the cover fields a card renders.
    expect(item?.cover).not.toBeNull();
    expect(item?.cover?.path).toMatch(/^products\//u);
    expect(item?.cover?.blurhash).toBeNull();
  });

  it('suggests products for the search box', async () => {
    const suggestions = await firestoreSearchPort.suggest(ctx, ANONYMOUS, 'gear');

    expect(suggestions.map((suggestion) => suggestion.slug)).toContain('gear-machine-builder');
  });

  it('answers category facets from the maintained counts', async () => {
    const facets = await firestoreSearchPort.facets(ctx, ANONYMOUS, {});

    expect(facets.countedDimensions).toEqual(['categories']);
    // `wooden` holds one product directly and one through `sensory`, rolled up by the seed.
    // Indexed rather than dotted, because the map is keyed by the branded `Slug` type.
    const wooden = (await findCategoryBySlug(ctx, 'wooden'))?.slug;
    expect(wooden).toBeDefined();
    if (wooden === undefined) return;
    expect(facets.categories[wooden]).toBe(2);
  });
});
