import { describe, expect, it } from 'vitest';

import {
  aCart,
  aCategory,
  aLedgerEntry,
  aNotification,
  aProduct,
  aRefund,
  aReview,
  aUser,
  aVariant,
  aWarehouse,
  anAddress,
  anInventoryRecord,
  anOrder,
  anOrderEvent,
  aReservation,
  checkoutSettings,
} from '@romp/contracts/fixtures';
import { NotFoundError } from '@romp/observability';

import { asCustomer, asOperator, asSystem, ANONYMOUS } from '../context';
import type { Caller } from '../context';
import { converters } from '../converters';
import { paths } from '../paths';
import { firestoreRecorder } from '../test-support/firestore-recorder';

import {
  findAddress,
  findCart,
  findDefaultAddress,
  findOwnCart,
  getOwnUser,
  getUser,
  isWishlisted,
  listAddresses,
  listWishlist,
} from './accounts';
import {
  findCategoryBySlug,
  findProductById,
  findProductBySlug,
  findProductsByIds,
  getCheckoutSettings,
  listAllProducts,
  listAllocatableWarehouses,
  listCategories,
  listFilterCategories,
  listNavCategories,
  listVariantOptions,
  listVariants,
  listWarehouses,
} from './catalogue';
import {
  findActiveReservationForOrder,
  findInventory,
  getAvailability,
  getVariantAvailability,
  listExpiredReservations,
  listLedgerForVariant,
  listLowStock,
  oldestExpiredReservationAgeMs,
  reconcileVariantStock,
} from './inventory';
import {
  countUnreadNotifications,
  findOrder,
  findOrderByHumanId,
  findReviewSlot,
  listModerationQueue,
  listNotifications,
  listOrderEvents,
  listOrders,
  listOrdersByFulfilmentStatus,
  listOrdersForUser,
  listOwnReviews,
  listPublishedReviews,
  listRefundsForOrder,
  listVerificationQueue,
} from './orders';
import { countQuery, getDocument, getDocuments } from './read';

/**
 * The repository layer.
 *
 * These tests assert two things a real-Firestore integration test cannot distinguish, and
 * both are security properties:
 *
 *  1. **Where the ownership filter lives.** `listOrdersForUser` returns the right documents
 *     whether the uid is a `where` clause or a `.filter()` after the read. Only the first
 *     is correct — the second returns short pages, bills for documents the caller may not
 *     see, and pulls another customer's data into this process. The recorder makes that an
 *     assertion.
 *  2. **That refusal is a 404.** A 403 confirms the resource exists, which discloses that
 *     an account or an order is real (`SECURITY.md` § 2).
 *
 * Whether the resulting queries have indexes and return the right rows is a different
 * question, answered in `infra/tests/repositories.test.ts` against the emulator.
 */

/**
 * Uids matching `@romp/contracts/fixtures`, so an order fixture is owned by `CUSTOMER`
 * without every test having to override `userId`. Aligning them here rather than
 * overriding per test keeps each test about the behaviour it names.
 */
const CUSTOMER_UID = 'customer-uid-0001';
const OTHER_UID = 'customer-uid-0002';
const STAFF_UID = 'staff-uid-0001';

const CUSTOMER: Caller = asCustomer(CUSTOMER_UID);
const OTHER: Caller = asCustomer(OTHER_UID);
const STAFF: Caller = asOperator(STAFF_UID, 'staff');
const OWNER: Caller = asOperator('owner-uid-0001', 'owner');
const SYSTEM: Caller = asSystem('sweeper');

/** Marks a fixture with the document ID the recorder should hand back. */
const withDocId = <T extends object>(id: string, document: T): T & { __id: string } => ({
  ...document,
  __id: id,
});

describe('products', () => {
  it('finds an active product by slug for anyone', async () => {
    const recorder = firestoreRecorder({
      documents: { products: [withDocId('wooden-blocks', aProduct())] },
    });

    const product = await findProductBySlug(recorder.context, ANONYMOUS, 'wooden-blocks');

    expect(product?.id).toBe('wooden-blocks');
  });

  it('queries on the slug rather than reading it as a document ID', async () => {
    // The slug is not the document ID for admin-created products; only seeded ones
    // coincide. Reading `products/{slug}` would work in development and miss in production.
    const recorder = firestoreRecorder({ documents: { products: [] } });
    await findProductBySlug(recorder.context, ANONYMOUS, 'wooden-blocks');

    expect(recorder.wheres()).toContainEqual(['slug', '==', 'wooden-blocks']);
  });

  it('hides a draft product from an anonymous caller', async () => {
    // Indistinguishable from a slug that never existed, which is the point.
    const recorder = firestoreRecorder({
      documents: { products: [withDocId('draft', aProduct({ status: 'draft' }))] },
    });

    expect(await findProductBySlug(recorder.context, ANONYMOUS, 'draft')).toBeNull();
  });

  it('hides a draft product from a signed-in customer', async () => {
    const recorder = firestoreRecorder({
      documents: { products: [withDocId('draft', aProduct({ status: 'draft' }))] },
    });

    expect(await findProductBySlug(recorder.context, CUSTOMER, 'draft')).toBeNull();
  });

  it('shows a draft product to staff', async () => {
    const recorder = firestoreRecorder({
      documents: { products: [withDocId('draft', aProduct({ status: 'draft' }))] },
    });

    expect(await findProductBySlug(recorder.context, STAFF, 'draft')).not.toBeNull();
  });

  it('lists every product newest-first for staff, across all statuses', async () => {
    const recorder = firestoreRecorder({
      documents: {
        products: [
          withDocId('draft', aProduct({ status: 'draft' })),
          withDocId('active', aProduct()),
        ],
      },
    });

    const products = await listAllProducts(recorder.context, STAFF, 200);

    expect(products).toHaveLength(2);
    // Newest edit first, and bounded — the backoffice list.
    expect(recorder.orderBys()).toContainEqual(['updatedAt', 'desc']);
  });

  it('refuses the backoffice product list to a non-staff caller', async () => {
    const recorder = firestoreRecorder({ documents: { products: [] } });

    await expect(listAllProducts(recorder.context, CUSTOMER, 200)).rejects.toThrow();
    await expect(listAllProducts(recorder.context, ANONYMOUS, 200)).rejects.toThrow();
  });

  it('applies the same visibility rule to a lookup by ID', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.product('draft')]: aProduct({ status: 'draft' }) },
    });

    expect(await findProductById(recorder.context, CUSTOMER, 'draft')).toBeNull();
    expect(await findProductById(recorder.context, STAFF, 'draft')).not.toBeNull();
  });

  it('returns null for a product that does not exist', async () => {
    const recorder = firestoreRecorder({});

    expect(await findProductById(recorder.context, STAFF, 'nope')).toBeNull();
  });

  it('reads several products in one round trip', async () => {
    const recorder = firestoreRecorder({
      byPath: {
        [paths.product('wooden-blocks')]: aProduct(),
        [paths.product('blocks-two')]: aProduct({
          slug: 'blocks-two' as ReturnType<typeof aProduct>['slug'],
        }),
      },
    });

    const products = await findProductsByIds(recorder.context, CUSTOMER, [
      'wooden-blocks',
      'blocks-two',
    ]);

    expect(products).toHaveLength(2);
    expect(recorder.batchedPaths).toHaveLength(2);
  });

  it('drops a since-archived product rather than failing the whole read', async () => {
    // A cart containing an archived product should render the rest of the cart.
    const recorder = firestoreRecorder({
      byPath: {
        [paths.product('wooden-blocks')]: aProduct(),
        [paths.product('gone')]: aProduct({ status: 'archived' }),
      },
    });

    expect(
      await findProductsByIds(recorder.context, CUSTOMER, ['wooden-blocks', 'gone']),
    ).toHaveLength(1);
    expect(
      await findProductsByIds(recorder.context, STAFF, ['wooden-blocks', 'gone']),
    ).toHaveLength(2);
  });

  it('omits products that do not exist rather than returning holes', async () => {
    // A sparse array with gaps at unpredictable indices invites an off-by-one.
    const recorder = firestoreRecorder({
      byPath: { [paths.product('wooden-blocks')]: aProduct() },
    });

    expect(
      await findProductsByIds(recorder.context, CUSTOMER, ['wooden-blocks', 'nope']),
    ).toHaveLength(1);
  });

  it('deduplicates repeated paths, because getAll rejects the same reference twice', async () => {
    // A caller collecting product IDs from order lines can legitimately produce duplicates.
    const recorder = firestoreRecorder({
      byPath: { [paths.product('wooden-blocks')]: aProduct() },
    });

    await findProductsByIds(recorder.context, CUSTOMER, ['wooden-blocks', 'wooden-blocks']);

    expect(recorder.batchedPaths).toEqual([paths.product('wooden-blocks')]);
  });

  it('reads nothing for an empty ID list', async () => {
    const recorder = firestoreRecorder({});

    expect(await findProductsByIds(recorder.context, CUSTOMER, [])).toEqual([]);
    expect(recorder.batchedPaths).toEqual([]);
  });

  it('refuses a collection path where a document was expected', async () => {
    // Otherwise this surfaces from inside the SDK as "documentPath must point to a
    // document", with no indication of which caller built it.
    const recorder = firestoreRecorder({});

    await expect(getDocument(recorder.context, 'products', converters.products)).rejects.toThrow(
      TypeError,
    );
    await expect(getDocuments(recorder.context, ['products'], converters.products)).rejects.toThrow(
      TypeError,
    );
  });

  it('counts without reading the documents', async () => {
    const recorder = firestoreRecorder({
      documents: { products: [withDocId('a', aProduct()), withDocId('b', aProduct())] },
    });

    const count = await countQuery(recorder.context.db.collection('products'));

    expect(count).toBe(2);
  });
});

describe('variants', () => {
  it('hides inactive variants from customers and shows them to staff', async () => {
    const documents = {
      [paths.variants('wooden-blocks')]: [
        withDocId('WB-240', aVariant()),
        withDocId('WB-OLD', aVariant({ active: false })),
      ],
    };

    const forCustomer = firestoreRecorder({ documents });
    const forStaff = firestoreRecorder({ documents });

    expect(await listVariants(forCustomer.context, CUSTOMER, 'wooden-blocks')).toHaveLength(1);
    expect(await listVariants(forStaff.context, STAFF, 'wooden-blocks')).toHaveLength(2);
  });

  it('orders variants by price, so the cheapest is preselected', async () => {
    const recorder = firestoreRecorder({ documents: { [paths.variants('p')]: [] } });
    await listVariants(recorder.context, CUSTOMER, 'p');

    expect(recorder.orderBys()).toContainEqual(['priceMinor', 'asc']);
  });

  it('derives availability without exposing a count', async () => {
    // Exact stock is staff-only. The PDP gets a boolean derived server-side.
    const recorder = firestoreRecorder({
      documents: { [paths.variants('wooden-blocks')]: [withDocId('WB-240', aVariant())] },
      byPath: { [paths.inventory('WB-240')]: anInventoryRecord() },
    });

    const options = await listVariantOptions(recorder.context, CUSTOMER, 'wooden-blocks');

    expect(options).toHaveLength(1);
    expect(options[0]?.inStock).toBe(true);
    expect(options[0]).not.toHaveProperty('available');
  });

  it('treats a missing inventory record as no stock', async () => {
    // A variant created a moment ago has no inventory document. That is genuinely no
    // stock, not an error, and not a reason to claim availability.
    const recorder = firestoreRecorder({
      documents: { [paths.variants('p')]: [withDocId('NEW-1', aVariant())] },
    });

    const options = await listVariantOptions(recorder.context, CUSTOMER, 'p');

    expect(options[0]?.inStock).toBe(false);
  });

  it('reads no inventory at all when a product has no variants', async () => {
    const recorder = firestoreRecorder({ documents: { [paths.variants('p')]: [] } });

    expect(await listVariantOptions(recorder.context, CUSTOMER, 'p')).toEqual([]);
    expect(recorder.batchedPaths).toEqual([]);
  });
});

describe('categories and settings', () => {
  it('reads categories with no caller filtering', async () => {
    // Navigation metadata, on every page. Nothing here is sensitive.
    const recorder = firestoreRecorder({
      documents: { categories: [withDocId('wooden', aCategory())] },
    });

    expect(await listCategories(recorder.context)).toHaveLength(1);
    expect(recorder.orderBys()).toContainEqual(['sortOrder', 'asc']);
  });

  it('filters the nav and sidebar lists in the query', async () => {
    const nav = firestoreRecorder({ documents: { categories: [] } });
    const sidebar = firestoreRecorder({ documents: { categories: [] } });

    await listNavCategories(nav.context);
    await listFilterCategories(sidebar.context);

    expect(nav.wheres()).toContainEqual(['showInNav', '==', true]);
    expect(sidebar.wheres()).toContainEqual(['showInFilters', '==', true]);
  });

  it('excludes an inactive category from the nav and sidebar lists', async () => {
    // `active` is filtered in memory (no composite index for a handful of documents), so a
    // deactivated category disappears from the storefront without being deleted.
    const documents = {
      categories: [
        withDocId('wooden', aCategory({ active: true, showInNav: true, showInFilters: true })),
        withDocId(
          'retired',
          aCategory({
            slug: 'retired' as ReturnType<typeof aCategory>['slug'],
            active: false,
            showInNav: true,
            showInFilters: true,
          }),
        ),
      ],
    };

    const nav = await listNavCategories(firestoreRecorder({ documents }).context);
    const sidebar = await listFilterCategories(firestoreRecorder({ documents }).context);

    expect(nav.map((category) => category.id)).toEqual(['wooden']);
    expect(sidebar.map((category) => category.id)).toEqual(['wooden']);
  });

  it('finds a category by slug', async () => {
    const recorder = firestoreRecorder({
      documents: { categories: [withDocId('wooden', aCategory())] },
    });

    expect(await findCategoryBySlug(recorder.context, 'wooden')).not.toBeNull();
    expect(recorder.wheres()).toContainEqual(['slug', '==', 'wooden']);
  });

  it('returns null when the store has no checkout settings yet', async () => {
    // The caller decides what that means. Falling back to the store config would quote a
    // fee that may no longer be charged.
    const recorder = firestoreRecorder({});

    expect(await getCheckoutSettings(recorder.context)).toBeNull();
  });

  it('reads checkout settings from the fixed singleton path', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.checkoutSettings()]: checkoutSettings() },
    });

    expect(await getCheckoutSettings(recorder.context)).not.toBeNull();
    expect(recorder.documentPaths).toContain('settings/checkout');
  });
});

describe('warehouses', () => {
  it('refuses a customer', async () => {
    // Publishing the list would publish the store's operational geography.
    const recorder = firestoreRecorder({ documents: { warehouses: [] } });

    await expect(listWarehouses(recorder.context, CUSTOMER)).rejects.toThrow(NotFoundError);
    await expect(listWarehouses(recorder.context, ANONYMOUS)).rejects.toThrow(NotFoundError);
  });

  it('allows staff and the system', async () => {
    const recorder = firestoreRecorder({
      documents: { warehouses: [withDocId('blr', aWarehouse())] },
    });

    expect(await listWarehouses(recorder.context, STAFF)).toHaveLength(1);
    expect(await listWarehouses(recorder.context, SYSTEM)).toHaveLength(1);
  });

  it('orders by allocation priority', async () => {
    const recorder = firestoreRecorder({ documents: { warehouses: [] } });
    await listWarehouses(recorder.context, STAFF);

    expect(recorder.orderBys()).toContainEqual(['priority', 'asc']);
  });

  it('excludes inactive warehouses from the allocatable list', async () => {
    // "Which warehouses exist" and "which can this order ship from" are different
    // questions, and the allocator must never accidentally ask the first.
    const recorder = firestoreRecorder({
      documents: {
        warehouses: [
          withDocId('blr', aWarehouse()),
          withDocId(
            'del',
            aWarehouse({ code: 'del' as ReturnType<typeof aWarehouse>['code'], active: false }),
          ),
        ],
      },
    });

    expect(await listAllocatableWarehouses(recorder.context, SYSTEM)).toHaveLength(1);
  });
});

describe('users and addresses', () => {
  it('lets a customer read their own record', async () => {
    const recorder = firestoreRecorder({ byPath: { [paths.user(CUSTOMER_UID)]: aUser() } });

    expect((await getUser(recorder.context, CUSTOMER, CUSTOMER_UID)).id).toBe(CUSTOMER_UID);
  });

  it('refuses a customer reading another account, with a 404', async () => {
    const recorder = firestoreRecorder({ byPath: { [paths.user(OTHER_UID)]: aUser() } });

    await expect(getUser(recorder.context, CUSTOMER, OTHER_UID)).rejects.toThrow(NotFoundError);
  });

  it('gives the same error for an account that does not exist', async () => {
    const recorder = firestoreRecorder({});

    await expect(getUser(recorder.context, CUSTOMER, CUSTOMER_UID)).rejects.toThrow(NotFoundError);
  });

  it('lets staff read any account', async () => {
    const recorder = firestoreRecorder({ byPath: { [paths.user(OTHER_UID)]: aUser() } });

    expect(await getUser(recorder.context, STAFF, OTHER_UID)).toBeDefined();
  });

  it('returns null from getOwnUser for an anonymous caller, without a read', async () => {
    // "Nobody is signed in" is a normal state for a page that renders differently when
    // they are, not an error.
    const recorder = firestoreRecorder({});

    expect(await getOwnUser(recorder.context, ANONYMOUS)).toBeNull();
    expect(recorder.documentPaths).toEqual([]);
  });

  it('refuses a foreign address list before touching Firestore', async () => {
    // The check is before the query, so a foreign uid never reaches the database.
    const recorder = firestoreRecorder({ documents: { '*': [] } });

    await expect(listAddresses(recorder.context, CUSTOMER, OTHER_UID)).rejects.toThrow(
      NotFoundError,
    );
    expect(recorder.collections).toEqual([]);
  });

  it('orders addresses with the default first', async () => {
    const recorder = firestoreRecorder({ documents: { '*': [] } });
    await listAddresses(recorder.context, CUSTOMER, CUSTOMER_UID);

    expect(recorder.orderBys()[0]).toEqual(['isDefault', 'desc']);
  });

  it('finds the default address from the ordered list', async () => {
    const recorder = firestoreRecorder({
      documents: {
        [paths.addresses(CUSTOMER_UID)]: [
          withDocId('home', anAddress()),
          withDocId('office', anAddress({ isDefault: false })),
        ],
      },
    });

    expect((await findDefaultAddress(recorder.context, CUSTOMER, CUSTOMER_UID))?.id).toBe('home');
  });

  it('returns null when a customer has no default address', async () => {
    const recorder = firestoreRecorder({
      documents: {
        [paths.addresses(CUSTOMER_UID)]: [withDocId('home', anAddress({ isDefault: false }))],
      },
    });

    expect(await findDefaultAddress(recorder.context, CUSTOMER, CUSTOMER_UID)).toBeNull();
  });

  it('refuses a foreign address by ID', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.address(OTHER_UID, 'home')]: anAddress() },
    });

    await expect(findAddress(recorder.context, CUSTOMER, OTHER_UID, 'home')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('wishlist', () => {
  it('refuses a foreign wishlist', async () => {
    const recorder = firestoreRecorder({ documents: { '*': [] } });

    await expect(listWishlist(recorder.context, CUSTOMER, OTHER_UID)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('answers false for an anonymous caller without a read', async () => {
    const recorder = firestoreRecorder({});

    expect(await isWishlisted(recorder.context, ANONYMOUS, 'wooden-blocks')).toBe(false);
    expect(recorder.documentPaths).toEqual([]);
  });

  it('is a point read, because the wishlist is keyed by product', async () => {
    const recorder = firestoreRecorder({
      byPath: {
        [paths.wishlistItem(CUSTOMER_UID, 'wooden-blocks')]: {
          productId: 'wooden-blocks',
          addedAt: new Date(),
        },
      },
    });

    expect(await isWishlisted(recorder.context, CUSTOMER, 'wooden-blocks')).toBe(true);
    expect(recorder.collections).toEqual([]);
  });
});

describe('carts', () => {
  it('checks the stored userId, not the document ID', async () => {
    // Otherwise the rule would be a naming convention: a cart at `carts/{their-uid}`
    // carrying a different `userId` would pass.
    const recorder = firestoreRecorder({
      byPath: {
        [paths.cart(CUSTOMER_UID)]: aCart({
          userId: OTHER_UID as ReturnType<typeof aCart>['userId'],
        }),
      },
    });

    await expect(findCart(recorder.context, CUSTOMER, CUSTOMER_UID)).rejects.toThrow(NotFoundError);
  });

  it('refuses an anonymous cart to every signed-in customer', async () => {
    // Reached by cookie through the API, never by uid.
    const recorder = firestoreRecorder({
      byPath: {
        [paths.cart('cookie-1')]: aCart({
          ownerType: 'anonymous',
          userId: null,
          expiresAt: new Date('2026-03-02T00:00:00.000Z'),
        }),
      },
    });

    await expect(findCart(recorder.context, CUSTOMER, 'cookie-1')).rejects.toThrow(NotFoundError);
    expect(await findCart(recorder.context, STAFF, 'cookie-1')).toBeDefined();
  });

  it('returns null for an anonymous caller own cart', async () => {
    const recorder = firestoreRecorder({});

    expect(await findOwnCart(recorder.context, ANONYMOUS)).toBeNull();
  });

  it('distinguishes no cart from an empty cart', async () => {
    // Only the second should show "your cart is empty" with a saved-items rail beneath.
    const empty = firestoreRecorder({
      byPath: { [paths.cart(CUSTOMER_UID)]: aCart({ items: [] }) },
    });
    const missing = firestoreRecorder({});

    expect(await findOwnCart(empty.context, CUSTOMER)).not.toBeNull();
    expect(await findOwnCart(missing.context, CUSTOMER)).toBeNull();
  });
});

describe('orders', () => {
  it('returns an order to its owner and refuses it to anyone else', async () => {
    const recorder = firestoreRecorder({ byPath: { [paths.order('order-1')]: anOrder() } });

    expect(await findOrder(recorder.context, CUSTOMER, 'order-1')).toBeDefined();
    await expect(findOrder(recorder.context, OTHER, 'order-1')).rejects.toThrow(NotFoundError);
    await expect(findOrder(recorder.context, ANONYMOUS, 'order-1')).rejects.toThrow(NotFoundError);
  });

  it('puts the ownership filter in the query, not after the read', async () => {
    // The assertion this whole file exists for. Filtering after the read returns short
    // pages and bills for documents the caller may not see.
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    await listOrdersForUser(recorder.context, CUSTOMER, CUSTOMER_UID);

    expect(recorder.wheres()).toContainEqual(['userId', '==', CUSTOMER_UID]);
  });

  it('refuses a foreign history before querying', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });

    await expect(listOrdersForUser(recorder.context, CUSTOMER, OTHER_UID)).rejects.toThrow(
      NotFoundError,
    );
    expect(recorder.collections).toEqual([]);
  });

  it('lets staff read a customer history, for support', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });

    await expect(listOrdersForUser(recorder.context, STAFF, OTHER_UID)).resolves.toEqual([]);
  });

  it('adds a status filter when asked', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    await listOrdersForUser(recorder.context, CUSTOMER, CUSTOMER_UID, { status: 'paid' });

    expect(recorder.wheres()).toContainEqual(['status', '==', 'paid']);
  });

  it('sorts the verification queue oldest first', async () => {
    // It is a work queue. Newest-first starves the oldest order, which is the one whose
    // reservation is closest to expiring.
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    await listVerificationQueue(recorder.context, STAFF);

    expect(recorder.wheres()).toContainEqual(['status', '==', 'pending_verification']);
    expect(recorder.orderBys()).toContainEqual(['createdAt', 'asc']);
  });

  it('refuses the verification queue to a customer', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });

    await expect(listVerificationQueue(recorder.context, CUSTOMER)).rejects.toThrow(NotFoundError);
  });

  it('filters fulfilment views on the nested status field', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    await listOrdersByFulfilmentStatus(recorder.context, STAFF, 'packed');

    expect(recorder.wheres()).toContainEqual(['fulfilment.status', '==', 'packed']);
  });

  it('keeps the human order number staff-only', async () => {
    // Exposing it would turn a guessable sequence into an order lookup, which is exactly
    // what keeping the two identifiers separate prevents.
    const recorder = firestoreRecorder({ documents: { orders: [] } });

    await expect(findOrderByHumanId(recorder.context, CUSTOMER, 'RMP-1001')).rejects.toThrow(
      NotFoundError,
    );
    expect(await findOrderByHumanId(recorder.context, STAFF, 'RMP-1001')).toBeNull();
  });

  it('lists orders newest-first, staff-only, with no filter by default', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    await listOrders(recorder.context, STAFF);

    expect(recorder.orderBys()).toContainEqual(['createdAt', 'desc']);
    // No status/fulfilment where clause when unfiltered.
    expect(recorder.wheres()).toEqual([]);
  });

  it('refuses the admin order list to a customer', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    await expect(listOrders(recorder.context, CUSTOMER)).rejects.toThrow(NotFoundError);
  });

  it('filters by payment status when asked', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    await listOrders(recorder.context, STAFF, { status: 'paid' });

    expect(recorder.wheres()).toContainEqual(['status', '==', 'paid']);
  });

  it('filters by fulfilment status on the nested field', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    await listOrders(recorder.context, STAFF, { fulfilmentStatus: 'shipped' });

    expect(recorder.wheres()).toContainEqual(['fulfilment.status', '==', 'shipped']);
  });

  it('applies only the payment status when both filters are given (index-safe)', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    await listOrders(recorder.context, STAFF, { status: 'paid', fulfilmentStatus: 'shipped' });

    expect(recorder.wheres()).toContainEqual(['status', '==', 'paid']);
    expect(recorder.wheres()).not.toContainEqual(['fulfilment.status', '==', 'shipped']);
  });

  it('short-circuits a humanId search to a single-order lookup, no pagination', async () => {
    const recorder = firestoreRecorder({ documents: { orders: [] } });
    const page = await listOrders(recorder.context, STAFF, { humanId: 'RMP-24817' });

    // The human-ID lookup query, not the paginated list — a `humanId` where, no createdAt order.
    expect(recorder.wheres()).toContainEqual(['humanId', '==', 'RMP-24817']);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([]);
  });

  it('issues a next cursor only when a further page exists', async () => {
    // Ask for 1, seed 2: hasMore, so a cursor is issued and the page is trimmed to the limit.
    const recorder = firestoreRecorder({
      documents: {
        orders: [withDocId('order-a', anOrder()), withDocId('order-b', anOrder())],
      },
    });
    const page = await listOrders(recorder.context, STAFF, { limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
  });

  it('applies a cursor as a startAfter clause', async () => {
    const first = firestoreRecorder({
      documents: {
        orders: [withDocId('order-a', anOrder()), withDocId('order-b', anOrder())],
      },
    });
    const page = await listOrders(first.context, STAFF, { limit: 1 });
    if (page.nextCursor === null) throw new Error('expected a cursor');

    const second = firestoreRecorder({ documents: { orders: [] } });
    await listOrders(second.context, STAFF, { limit: 1, cursor: page.nextCursor });

    const startAfter = second.collections
      .flatMap((collection) => collection.clauses)
      .find((clause) => clause.kind === 'startAfter');
    expect(startAfter).toBeDefined();
    expect(startAfter?.args).toHaveLength(2);
  });

  it('checks the parent order before reading its audit trail', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.order('order-1')]: anOrder() },
      documents: { [paths.orderEvents('order-1')]: [withDocId('ev-1', anOrderEvent())] },
    });

    expect(await listOrderEvents(recorder.context, CUSTOMER, 'order-1')).toHaveLength(1);
    await expect(listOrderEvents(recorder.context, OTHER, 'order-1')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('reads the audit trail chronologically', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.order('order-1')]: anOrder() },
      documents: { [paths.orderEvents('order-1')]: [] },
    });
    await listOrderEvents(recorder.context, CUSTOMER, 'order-1');

    expect(recorder.orderBys()).toContainEqual(['at', 'asc']);
  });

  it('checks the order before listing its refunds', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.order('order-1')]: anOrder() },
      documents: { refunds: [withDocId('rf-1', aRefund())] },
    });

    expect(await listRefundsForOrder(recorder.context, CUSTOMER, 'order-1')).toHaveLength(1);
    await expect(listRefundsForOrder(recorder.context, OTHER, 'order-1')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('notifications', () => {
  it('gives a customer their own feed, filtered in the query', async () => {
    const recorder = firestoreRecorder({ documents: { notifications: [] } });
    await listNotifications(recorder.context, CUSTOMER);

    expect(recorder.wheres()).toContainEqual(['userId', '==', CUSTOMER_UID]);
  });

  it('gives staff the admin audience', async () => {
    // Which feed is decided by the caller's role, not by a parameter — a parameter would
    // let a customer ask for the admin feed and rely on a filter further down.
    const recorder = firestoreRecorder({ documents: { notifications: [] } });
    await listNotifications(recorder.context, STAFF);

    expect(recorder.wheres()).toContainEqual(['audience', '==', 'admin']);
  });

  it('returns nothing for an anonymous caller, without a query', async () => {
    const recorder = firestoreRecorder({ documents: { notifications: [] } });

    expect(await listNotifications(recorder.context, ANONYMOUS)).toEqual([]);
    expect(recorder.collections).toEqual([]);
  });

  it('filters unread customer notifications on an explicit null', async () => {
    // `readAt` is written as null rather than omitted precisely so this filter works:
    // Firestore's `== null` matches a null field and not a missing one.
    const recorder = firestoreRecorder({ documents: { notifications: [] } });
    await listNotifications(recorder.context, CUSTOMER, { unreadOnly: true });

    expect(recorder.wheres()).toContainEqual(['readAt', '==', null]);
  });

  it('filters unread staff notifications in memory, on the readBy map', async () => {
    // Firestore cannot express "this map lacks my key", so the staff feed is read whole
    // and filtered here — bounded by the limit, so the cost is bounded too.
    const recorder = firestoreRecorder({
      documents: {
        notifications: [
          withDocId('n1', aNotification({ audience: 'admin', userId: null, readBy: {} })),
          withDocId(
            'n2',
            aNotification({
              audience: 'admin',
              userId: null,
              readBy: { [STAFF_UID]: new Date('2026-03-01T10:00:00.000Z') } as ReturnType<
                typeof aNotification
              >['readBy'],
            }),
          ),
        ],
      },
    });

    const unread = await listNotifications(recorder.context, STAFF, { unreadOnly: true });

    expect(unread.map((notification) => notification.id)).toEqual(['n1']);
  });

  it('caps the unread count rather than counting exactly', async () => {
    // A bell renders 99+, so counting beyond that bills for a number nobody displays.
    const recorder = firestoreRecorder({
      documents: {
        notifications: Array.from({ length: 5 }, (_unused, index) =>
          withDocId(`n${String(index)}`, aNotification()),
        ),
      },
    });

    expect(await countUnreadNotifications(recorder.context, CUSTOMER, { cap: 3 })).toBe(5);
  });
});

describe('reviews', () => {
  it('serves only published reviews publicly', async () => {
    const recorder = firestoreRecorder({ documents: { reviews: [] } });
    await listPublishedReviews(recorder.context, 'wooden-blocks');

    expect(recorder.wheres()).toContainEqual(['productId', '==', 'wooden-blocks']);
    expect(recorder.wheres()).toContainEqual(['status', '==', 'published']);
  });

  it('lets an author read their own reviews in any status', async () => {
    // So they can see a pending review was received rather than concluding the form broke.
    const recorder = firestoreRecorder({ documents: { reviews: [withDocId('r1', aReview())] } });

    expect(await listOwnReviews(recorder.context, CUSTOMER, CUSTOMER_UID)).toHaveLength(1);
    expect(recorder.wheres().some((clause) => clause[0] === 'status')).toBe(false);
  });

  it('refuses another customer reviews', async () => {
    const recorder = firestoreRecorder({ documents: { reviews: [] } });

    await expect(listOwnReviews(recorder.context, CUSTOMER, OTHER_UID)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('sorts the moderation queue oldest first', async () => {
    const recorder = firestoreRecorder({ documents: { reviews: [] } });
    await listModerationQueue(recorder.context, STAFF);

    expect(recorder.wheres()).toContainEqual(['status', '==', 'pending']);
    expect(recorder.orderBys()).toContainEqual(['createdAt', 'asc']);
  });

  it('refuses the moderation queue to a customer', async () => {
    const recorder = firestoreRecorder({ documents: { reviews: [] } });

    await expect(listModerationQueue(recorder.context, CUSTOMER)).rejects.toThrow(NotFoundError);
  });

  it('treats only pending and published as occupying the review slot', async () => {
    // A rejected review does not, so a customer whose review was rejected may write
    // another — which is the point of not telling them why.
    const recorder = firestoreRecorder({ documents: { reviews: [] } });
    await findReviewSlot(recorder.context, CUSTOMER, CUSTOMER_UID, 'wooden-blocks');

    expect(recorder.wheres()).toContainEqual(['status', 'in', ['pending', 'published']]);
  });
});

describe('inventory', () => {
  it('gives a customer availability with no count attached', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.inventory('WB-240')]: anInventoryRecord() },
    });

    const [availability] = await getAvailability(recorder.context, CUSTOMER, ['WB-240']);

    expect(availability?.inStock).toBe(true);
    expect(availability?.available).toBeNull();
  });

  it('gives staff the count', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.inventory('WB-240')]: anInventoryRecord() },
    });

    const [availability] = await getAvailability(recorder.context, STAFF, ['WB-240']);

    // 20 on hand minus 3 reserved.
    expect(availability?.available).toBe(17);
  });

  it('treats stock held by unpaid orders as unavailable', async () => {
    // The honest answer: a customer who added it would fail at checkout.
    const recorder = firestoreRecorder({
      byPath: {
        [paths.inventory('WB-240')]: anInventoryRecord({ onHandTotal: 20, reserved: 20 }),
      },
    });

    const [availability] = await getAvailability(recorder.context, CUSTOMER, ['WB-240']);

    expect(availability?.inStock).toBe(false);
  });

  it('returns an entry per requested variant, in order, including unknown ones', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.inventory('WB-240')]: anInventoryRecord() },
    });

    const availability = await getAvailability(recorder.context, CUSTOMER, ['WB-240', 'NOPE']);

    expect(availability.map((entry) => entry.variantId)).toEqual(['WB-240', 'NOPE']);
    expect(availability[1]?.inStock).toBe(false);
  });

  it('reads nothing for an empty variant list', async () => {
    const recorder = firestoreRecorder({});

    expect(await getAvailability(recorder.context, CUSTOMER, [])).toEqual([]);
    expect(recorder.batchedPaths).toEqual([]);
  });

  it('answers a single-variant question totally', async () => {
    const recorder = firestoreRecorder({});

    expect(await getVariantAvailability(recorder.context, CUSTOMER, 'NOPE')).toEqual({
      variantId: 'NOPE',
      inStock: false,
      available: null,
    });
  });

  it('keeps the full inventory document staff-only', async () => {
    const recorder = firestoreRecorder({
      byPath: { [paths.inventory('WB-240')]: anInventoryRecord() },
    });

    await expect(findInventory(recorder.context, CUSTOMER, 'WB-240')).rejects.toThrow(
      NotFoundError,
    );
    expect(await findInventory(recorder.context, STAFF, 'WB-240')).not.toBeNull();
  });

  it('filters low stock in memory, because Firestore cannot compare two fields', async () => {
    const recorder = firestoreRecorder({
      documents: {
        inventory: [
          withDocId(
            'LOW',
            anInventoryRecord({
              onHandTotal: 4,
              reserved: 0,
              lowStockThreshold: 5,
              stock: { blr: 4 } as ReturnType<typeof anInventoryRecord>['stock'],
            }),
          ),
          withDocId('FINE', anInventoryRecord()),
        ],
      },
    });

    const low = await listLowStock(recorder.context, STAFF);

    expect(low.map((record) => record.id)).toEqual(['LOW']);
    expect(recorder.orderBys()).toContainEqual(['onHandTotal', 'asc']);
  });

  it('uses the context clock for the sweeper boundary', async () => {
    // So a test can place the boundary exactly instead of sleeping.
    const recorder = firestoreRecorder({
      documents: { reservations: [] },
      now: new Date('2026-03-01T09:30:00.000Z'),
    });
    await listExpiredReservations(recorder.context, SYSTEM);

    expect(recorder.wheres()).toContainEqual(['status', '==', 'active']);
    expect(recorder.wheres()).toContainEqual([
      'expiresAt',
      '<=',
      new Date('2026-03-01T09:30:00.000Z'),
    ]);
  });

  it('reports backlog age, not an error rate', async () => {
    // A sweeper that has crashed emits no errors, so an error-rate alert on it fires only
    // when the sweeper is working well enough to fail.
    const recorder = firestoreRecorder({
      documents: {
        reservations: [
          withDocId(
            'res-1',
            aReservation({
              expiresAt: new Date('2026-03-01T09:00:00.000Z'),
              createdAt: new Date('2026-03-01T08:30:00.000Z'),
            }),
          ),
        ],
      },
      now: new Date('2026-03-01T09:30:00.000Z'),
    });

    expect(await oldestExpiredReservationAgeMs(recorder.context, SYSTEM)).toBe(30 * 60 * 1_000);
  });

  it('reports null rather than zero when nothing is overdue', async () => {
    // Zero and "nothing to measure" would otherwise be the same reading.
    const recorder = firestoreRecorder({ documents: { reservations: [] } });

    expect(await oldestExpiredReservationAgeMs(recorder.context, SYSTEM)).toBeNull();
  });

  it('looks only for an active reservation on an order', async () => {
    // A committed one has already moved its units; a released one has given them back.
    const recorder = firestoreRecorder({ documents: { reservations: [] } });
    await findActiveReservationForOrder(recorder.context, SYSTEM, 'order-1');

    expect(recorder.wheres()).toContainEqual(['status', '==', 'active']);
    expect(recorder.wheres()).toContainEqual(['orderId', '==', 'order-1']);
  });

  it('keeps the ledger staff-only and newest first', async () => {
    const recorder = firestoreRecorder({ documents: { inventoryLedger: [] } });

    await expect(listLedgerForVariant(recorder.context, CUSTOMER, 'WB-240')).rejects.toThrow(
      NotFoundError,
    );
    await listLedgerForVariant(recorder.context, STAFF, 'WB-240');
    expect(recorder.orderBys()).toContainEqual(['at', 'desc']);
  });

  it('reconciles the ledger against the stored balance', async () => {
    const recorder = firestoreRecorder({
      byPath: {
        [paths.inventory('WB-240')]: anInventoryRecord({
          stock: { blr: 12 } as ReturnType<typeof anInventoryRecord>['stock'],
          onHandTotal: 12,
          reserved: 0,
        }),
      },
      documents: { inventoryLedger: [withDocId('e1', aLedgerEntry({ delta: 12 }))] },
    });

    const result = await reconcileVariantStock(recorder.context, STAFF, 'WB-240');

    expect(result.balanced).toBe(true);
    expect(result.ledgerByWarehouse).toEqual({ blr: 12 });
    expect(result.entryCount).toBe(1);
  });

  it('detects a discrepancy in either direction', async () => {
    const recorder = firestoreRecorder({
      byPath: {
        [paths.inventory('WB-240')]: anInventoryRecord({
          stock: { blr: 12 } as ReturnType<typeof anInventoryRecord>['stock'],
          onHandTotal: 12,
          reserved: 0,
        }),
      },
      documents: { inventoryLedger: [withDocId('e1', aLedgerEntry({ delta: 8 }))] },
    });

    expect((await reconcileVariantStock(recorder.context, STAFF, 'WB-240')).balanced).toBe(false);
  });

  it('notices a warehouse the ledger knows and the balance has dropped', async () => {
    // Comparing only the stored keys would miss exactly this — the discrepancy most worth
    // finding.
    const recorder = firestoreRecorder({
      byPath: {
        [paths.inventory('WB-240')]: anInventoryRecord({
          stock: {},
          onHandTotal: 0,
          reserved: 0,
        }),
      },
      documents: { inventoryLedger: [withDocId('e1', aLedgerEntry({ delta: 5 }))] },
    });

    const result = await reconcileVariantStock(recorder.context, STAFF, 'WB-240');

    expect(result.balanced).toBe(false);
    expect(result.ledgerByWarehouse).toEqual({ blr: 5 });
    expect(result.storedByWarehouse).toEqual({});
  });

  it('refuses reconciliation to a customer', async () => {
    const recorder = firestoreRecorder({});

    await expect(reconcileVariantStock(recorder.context, CUSTOMER, 'WB-240')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('reports an owner as staff for backoffice reads', async () => {
    const recorder = firestoreRecorder({ documents: { inventory: [] } });

    await expect(listLowStock(recorder.context, OWNER)).resolves.toEqual([]);
  });
});
