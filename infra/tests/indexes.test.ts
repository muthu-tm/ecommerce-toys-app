import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ProductQuery } from '@romp/contracts';
import type { Caller } from '@romp/data';
import { firestoreSearchPort, asCustomer, asOperator } from '@romp/data';
import { firestoreRecorder } from '@romp/data/test-support';

/**
 * Index coverage.
 *
 * This suite exists because of a gap the emulator leaves open: **the Firestore emulator
 * creates whatever index a query needs, on demand.** Production does not — it rejects the
 * query with `FAILED_PRECONDITION` and a console link. So an integration test can pass on
 * every query shape the code builds while production fails half of them, on whichever page
 * needed the shape first.
 *
 * The check is therefore static. Each query the storefront and backoffice actually issue is
 * driven through the **real adapter** against a recorder, and the clauses it produces are
 * matched against `firestore.indexes.json`. Driving the real adapter rather than restating
 * its clauses by hand is the point: a change to how the adapter filters shows up here
 * automatically, instead of in a table someone forgot to update.
 */

const indexFile = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'firestore.indexes.json'), 'utf8'),
) as {
  indexes: readonly {
    collectionGroup: string;
    queryScope: string;
    fields: readonly { fieldPath: string; order?: string; arrayConfig?: string }[];
  }[];
  fieldOverrides: readonly { collectionGroup: string; fieldPath: string; ttl?: boolean }[];
};

const CUSTOMER: Caller = asCustomer('customer-1');
const STAFF: Caller = asOperator('staff-1', 'staff');

/**
 * The equality, array and range fields a query filters on, plus its ordering fields.
 *
 * Firestore needs a composite index when a query combines more than one field across
 * filters and ordering. A single-field equality or ordering is served by the automatic
 * single-field indexes, which is why those are not required to appear in the file.
 */
interface QueryShape {
  readonly equalities: readonly string[];
  readonly arrayContains: readonly string[];
  readonly ranges: readonly string[];
  readonly orderBy: readonly string[];
}

/** Drives the real adapter and reads back the clauses it built. */
async function shapeOf(query: ProductQuery, caller: Caller = CUSTOMER): Promise<QueryShape> {
  const recorder = firestoreRecorder({ documents: { products: [] } });
  await firestoreSearchPort.searchProducts(recorder.context, caller, query);

  const equalities: string[] = [];
  const arrayContains: string[] = [];
  const ranges: string[] = [];

  for (const [field, op] of recorder.wheres() as [string, string][]) {
    if (op === '==' || op === 'in') equalities.push(field);
    else if (op === 'array-contains' || op === 'array-contains-any') arrayContains.push(field);
    else ranges.push(field);
  }

  return {
    equalities,
    arrayContains,
    ranges,
    // `__name__` is the document-ID tiebreaker. Firestore appends it to every index
    // implicitly, so it is never declared in the index file and is dropped here.
    orderBy: recorder
      .orderBys()
      .map(([field]) => String(field))
      .filter((field) => field !== '__name__'),
  };
}

/**
 * Whether a declared index can serve a shape.
 *
 * Firestore's rule: every equality and array field must appear in the index, the range
 * field must come immediately before the ordering fields, and the ordering fields must
 * appear in the same sequence. Equality fields may appear in any order relative to each
 * other, which is why they are compared as a set.
 */
function canServe(
  index: (typeof indexFile.indexes)[number],
  shape: QueryShape,
  collection: string,
): boolean {
  if (index.collectionGroup !== collection) return false;

  const indexFields = index.fields.map((field) => field.fieldPath);
  const required = [...shape.equalities, ...shape.arrayContains, ...shape.ranges];

  // Every field the query touches has to be in the index.
  if (!required.every((field) => indexFields.includes(field))) return false;

  // The ordering fields have to be the index's trailing fields, in order.
  const tail = indexFields.slice(indexFields.length - shape.orderBy.length);
  return (
    shape.orderBy.length === 0 ||
    (tail.length === shape.orderBy.length && tail.every((field, at) => field === shape.orderBy[at]))
  );
}

/** How many fields the query constrains in total. One does not need a composite index. */
function fieldCount(shape: QueryShape): number {
  return new Set([...shape.equalities, ...shape.arrayContains, ...shape.ranges, ...shape.orderBy])
    .size;
}

/**
 * Every catalogue query the product actually issues.
 *
 * Kept as a list of *user intents* rather than of query objects, so a reader can tell what
 * would break if an index were removed.
 */
const CATALOGUE_QUERIES: readonly (readonly [string, ProductQuery, Caller?])[] = [
  ['the home page and top-level listing', {}],
  ['a category listing', { categorySlugs: ['wooden'] }],
  ['a category listing sorted by price', { categorySlugs: ['wooden'], sort: 'price_asc' }],
  [
    'a category listing sorted by price, descending',
    { categorySlugs: ['wooden'], sort: 'price_desc' },
  ],
  ['a category listing sorted by rating', { categorySlugs: ['wooden'], sort: 'rating_desc' }],
  ['a multi-category filter', { categorySlugs: ['wooden', 'puzzles'] }],
  ['an age-band listing', { ageBands: ['3-5'] }],
  ['an age-band listing sorted by price', { ageBands: ['3-5'], sort: 'price_asc' }],
  ['an age-band listing sorted by price, descending', { ageBands: ['3-5'], sort: 'price_desc' }],
  ['an age-band listing sorted by rating', { ageBands: ['3-5'], sort: 'rating_desc' }],
  [
    'category and age band together',
    { categorySlugs: ['wooden'], ageBands: ['3-5'], sort: 'price_asc' },
  ],
  ['a brand listing', { brands: ['Kaadu'], sort: 'price_asc' }],
  ['a price band', { price: { minMinor: 50_000, maxMinor: 200_000 }, sort: 'price_asc' }],
  ['the search box', { text: 'beech', sort: 'price_asc' }],
  ['the search box sorted by rating', { text: 'beech', sort: 'rating_desc' }],
  ['the backoffice catalogue list', {}, STAFF],
];

describe('every catalogue query has an index', () => {
  for (const [label, query, caller] of CATALOGUE_QUERIES) {
    it(`serves ${label}`, async () => {
      const shape = await shapeOf(query, caller ?? CUSTOMER);

      // A query constraining one field is served by Firestore's automatic single-field
      // indexes, so it needs no declaration.
      if (fieldCount(shape) <= 1) return;

      const served = indexFile.indexes.some((index) => canServe(index, shape, 'products'));

      expect(
        served,
        `No index in firestore.indexes.json serves ${label}: ${JSON.stringify(shape)}`,
      ).toBe(true);
    });
  }
});

/**
 * Repository queries, as shapes.
 *
 * Restated by hand rather than driven through the recorder, because each of these lives in
 * a different repository function with a different signature and driving all of them would
 * be more indirection than the check is worth. The cost is that this list can fall behind;
 * the mitigation is that `tests/repositories.test.ts` runs every one of these against the
 * emulator, so a *renamed field* is caught there even though a *missing index* is caught
 * only here.
 */
const REPOSITORY_QUERIES: readonly (readonly [string, string, QueryShape])[] = [
  [
    'account order history',
    'orders',
    { equalities: ['userId'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'account order history filtered by status',
    'orders',
    { equalities: ['userId', 'status'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'the payment verification queue',
    'orders',
    { equalities: ['status'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'admin fulfilment views',
    'orders',
    { equalities: ['fulfilment.status'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'the admin order list filtered by payment status',
    'orders',
    { equalities: ['status'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'the admin order list filtered by fulfilment status',
    'orders',
    { equalities: ['fulfilment.status'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'order lookup by customer-facing number',
    'orders',
    { equalities: ['humanId'], arrayContains: [], ranges: [], orderBy: [] },
  ],
  [
    'the reservation sweeper',
    'reservations',
    { equalities: ['status'], arrayContains: [], ranges: ['expiresAt'], orderBy: ['expiresAt'] },
  ],
  [
    'the customer notification bell',
    'notifications',
    { equalities: ['userId'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'the customer unread count',
    'notifications',
    { equalities: ['userId', 'readAt'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'the admin notification bell',
    'notifications',
    { equalities: ['audience'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'the product detail review list',
    'reviews',
    {
      equalities: ['productId', 'status'],
      arrayContains: [],
      ranges: [],
      orderBy: ['createdAt'],
    },
  ],
  [
    'the moderation queue',
    'reviews',
    { equalities: ['status'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'a customer own reviews',
    'reviews',
    { equalities: ['userId'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'the one-review-per-product slot check',
    'reviews',
    { equalities: ['userId', 'productId', 'status'], arrayContains: [], ranges: [], orderBy: [] },
  ],
  [
    'the variant ledger',
    'inventoryLedger',
    { equalities: ['variantId'], arrayContains: [], ranges: [], orderBy: ['at'] },
  ],
  [
    'per-warehouse reconciliation',
    'inventoryLedger',
    { equalities: ['variantId', 'warehouseId'], arrayContains: [], ranges: [], orderBy: ['at'] },
  ],
  [
    'the low-stock report',
    'inventory',
    { equalities: [], arrayContains: [], ranges: [], orderBy: ['onHandTotal'] },
  ],
  [
    'refunds for an order',
    'refunds',
    { equalities: ['orderId'], arrayContains: [], ranges: [], orderBy: ['createdAt'] },
  ],
  [
    'the storefront nav',
    'categories',
    { equalities: ['showInNav'], arrayContains: [], ranges: [], orderBy: ['sortOrder'] },
  ],
  [
    'the listing sidebar',
    'categories',
    { equalities: ['showInFilters'], arrayContains: [], ranges: [], orderBy: ['sortOrder'] },
  ],
];

describe('every repository query has an index', () => {
  for (const [label, collection, shape] of REPOSITORY_QUERIES) {
    it(`serves ${label}`, () => {
      if (fieldCount(shape) <= 1) return;

      const served = indexFile.indexes.some((index) => canServe(index, shape, collection));

      expect(served, `No index in firestore.indexes.json serves ${label}`).toBe(true);
    });
  }
});

describe('the matcher can fail', () => {
  /**
   * A coverage check that cannot fail proves nothing.
   *
   * These three assert the negative: that `canServe` rejects an index missing a field the
   * query filters on, one whose ordering fields are not the trailing ones, and one for a
   * different collection. Without them, an early `return` or an inverted condition would
   * make every test above pass vacuously — and the whole suite would be a green light on
   * an empty index file.
   */
  it('rejects a query filtering on a field the index does not contain', () => {
    const shape: QueryShape = {
      equalities: ['status', 'somethingNobodyIndexed'],
      arrayContains: [],
      ranges: [],
      orderBy: ['priceFromMinor'],
    };

    expect(indexFile.indexes.some((index) => canServe(index, shape, 'products'))).toBe(false);
  });

  it('rejects an index whose ordering fields are not its trailing fields', () => {
    // `status, categorySlug, priceFromMinor` cannot serve an ordering by `categorySlug`,
    // because Firestore reads the ordering off the end of the index.
    const shape: QueryShape = {
      equalities: ['status'],
      arrayContains: [],
      ranges: [],
      orderBy: ['categorySlug'],
    };

    expect(indexFile.indexes.some((index) => canServe(index, shape, 'products'))).toBe(false);
  });

  it('rejects an index declared for a different collection', () => {
    const shape: QueryShape = {
      equalities: ['userId'],
      arrayContains: [],
      ranges: [],
      orderBy: ['createdAt'],
    };

    // Served for `orders`, and deliberately not declared for `products`.
    expect(indexFile.indexes.some((index) => canServe(index, shape, 'orders'))).toBe(true);
    expect(indexFile.indexes.some((index) => canServe(index, shape, 'products'))).toBe(false);
  });

  it('recognises the catalogue queries as multi-field, so they are really checked', async () => {
    // Guards the `fieldCount(shape) <= 1` early return: if the adapter stopped emitting a
    // status filter, every catalogue test above would skip its assertion and still pass.
    const shape = await shapeOf({ categorySlugs: ['wooden'], sort: 'price_asc' });

    expect(fieldCount(shape)).toBeGreaterThan(1);
    expect(shape.equalities).toContain('status');
  });
});

describe('the index file itself', () => {
  it('declares no duplicate indexes', () => {
    // A duplicate costs write throughput and storage for nothing, and Firestore accepts it
    // silently.
    const signatures = indexFile.indexes.map((index) =>
      [
        index.collectionGroup,
        index.queryScope,
        ...index.fields.map(
          (field) => `${field.fieldPath}:${field.order ?? field.arrayConfig ?? ''}`,
        ),
      ].join('|'),
    );

    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('gives every index at least two fields', () => {
    // A single-field composite index is redundant: Firestore maintains those automatically.
    for (const index of indexFile.indexes) {
      expect(index.fields.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('puts at most one array field in each index', () => {
    // Firestore permits one `array-contains` clause per query, so a second array field in
    // an index can never be used.
    for (const index of indexFile.indexes) {
      const arrayFields = index.fields.filter((field) => field.arrayConfig !== undefined);
      expect(arrayFields.length).toBeLessThanOrEqual(1);
    }
  });

  it('declares the TTL policies the data model relies on', () => {
    // Notifications are not an archive, and an anonymous cart has no owner who will ever
    // clear it. Without these, both collections grow without bound.
    const ttlFields = indexFile.fieldOverrides
      .filter((override) => override.ttl === true)
      .map((override) => `${override.collectionGroup}.${override.fieldPath}`);

    expect(ttlFields).toContain('notifications.expiresAt');
    expect(ttlFields).toContain('carts.expiresAt');
  });

  it('exempts the large fields nothing queries', () => {
    // Firestore indexes every field by default. A 5 000-character description and an
    // `items` array on every order cost write throughput for a query nobody issues.
    const exempted = indexFile.fieldOverrides
      .filter((override) => override.ttl !== true)
      .map((override) => `${override.collectionGroup}.${override.fieldPath}`);

    for (const field of [
      'products.description',
      'products.variantSummary',
      'orders.items',
      'orders.shippingAddress',
      'events.payload',
      'notifications.readBy',
    ]) {
      expect(exempted).toContain(field);
    }
  });
});
