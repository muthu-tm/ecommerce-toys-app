import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { aProduct, aWarehouse, anOrder } from '@romp/contracts/fixtures';

import { DocumentShapeError, withId } from './converter';
import { converters, CONVERTER_COLLECTIONS } from './converters';
import { COLLECTIONS, SUBCOLLECTIONS } from './paths';

/**
 * The validating converters.
 *
 * `fromFirestore` takes a `QueryDocumentSnapshot`, of which only `id` and `data()`
 * are used. Constructing a real one needs a Firestore instance, so it is faked to
 * exactly that surface — a fake here is honest, because the converter genuinely does
 * not touch anything else, and the emulator suite in `infra/` covers the real
 * snapshot path end to end.
 */
function snapshotOf(id: string, data: Record<string, unknown>): QueryDocumentSnapshot {
  return { id, data: () => data } as unknown as QueryDocumentSnapshot;
}

/** Re-encodes a decoded fixture the way Firestore would return it. */
function asStored(document: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(document).map(([key, value]) => [
      key,
      value instanceof Date ? Timestamp.fromDate(value) : value,
    ]),
  );
}

describe('reading a document', () => {
  it('decodes timestamps and returns a validated document', () => {
    const warehouse = aWarehouse();
    const decoded = converters.warehouses.fromFirestore(
      snapshotOf('blr', asStored({ ...warehouse })),
    );

    expect(decoded.code).toBe('blr');
    expect(decoded.createdAt).toBeInstanceOf(Date);
    expect(decoded.createdAt.toISOString()).toBe(warehouse.createdAt.toISOString());
  });

  it('rejects a stored document that violates its own invariants', () => {
    // The write that produced this may have shipped weeks ago, or predated the
    // invariant. Without read validation the bad value is simply believed.
    const order = anOrder();
    const corrupted = asStored({
      ...order,
      amounts: { ...order.amounts, totalMinor: order.amounts.totalMinor + 5 },
    });

    expect(() => converters.orders.fromFirestore(snapshotOf('order-1', corrupted))).toThrow(
      DocumentShapeError,
    );
  });

  it('names the collection, the document and the field path in the failure', () => {
    const order = anOrder();
    const corrupted = asStored({
      ...order,
      amounts: { ...order.amounts, totalMinor: order.amounts.totalMinor + 5 },
    });

    try {
      converters.orders.fromFirestore(snapshotOf('order-42', corrupted));
      throw new Error('expected the converter to reject this document');
    } catch (error) {
      if (!(error instanceof DocumentShapeError)) throw error;

      // The three questions asked when this fires are always which document, which
      // field, and read or write.
      expect(error.collection).toBe('orders');
      expect(error.documentId).toBe('order-42');
      expect(error.direction).toBe('read');
      expect(error.issues.map((issue) => issue.path)).toContain('amounts.totalMinor');
      expect(error.message).toContain('orders/order-42');
    }
  });

  it('rejects a document missing a required field', () => {
    const { name: _name, ...withoutName } = aWarehouse();

    expect(() =>
      converters.warehouses.fromFirestore(snapshotOf('blr', asStored(withoutName))),
    ).toThrow(DocumentShapeError);
  });

  it('strips a field the schema does not know about', () => {
    // Rolling deploys mean the old version reads documents the new version wrote.
    const decoded = converters.warehouses.fromFirestore(
      snapshotOf('blr', { ...asStored({ ...aWarehouse() }), addedLater: 'ignored' }),
    );

    expect(decoded).not.toHaveProperty('addedLater');
  });

  it('reports a whole-document failure at the root', () => {
    // A document that is not a map at all has no field to blame, and `(root)` is more
    // useful than an empty path rendered as an empty string.
    try {
      converters.warehouses.fromFirestore(
        snapshotOf('blr', 'not a map' as unknown as Record<string, unknown>),
      );
      throw new Error('expected the converter to reject this document');
    } catch (error) {
      if (!(error instanceof DocumentShapeError)) throw error;
      expect(error.issues.map((issue) => issue.path)).toContain('(root)');
    }
  });

  it('rejects a raw Timestamp reaching the schema undecoded', () => {
    // Guards the decode step itself: if `fromFirestore` stopped decoding, this is the
    // test that fails rather than a `getTime is not a function` in a route.
    const raw = { ...aWarehouse(), createdAt: { seconds: 1, nanoseconds: 0 } };

    expect(() => converters.warehouses.fromFirestore(snapshotOf('blr', raw))).toThrow(
      DocumentShapeError,
    );
  });
});

describe('writing a document', () => {
  it('returns validated data for a valid document', () => {
    const written = converters.warehouses.toFirestore(aWarehouse());

    expect(written.code).toBe('blr');
    expect(written.createdAt).toBeInstanceOf(Date);
  });

  it('refuses to write a document that violates its own invariants', () => {
    const product = aProduct();

    expect(() =>
      converters.products.toFirestore({ ...product, ratingCount: 0, ratingAvg: 4.6 }),
    ).toThrow(DocumentShapeError);
  });

  it('reports a write failure as a write', () => {
    try {
      converters.products.toFirestore({ ...aProduct(), ratingCount: 0, ratingAvg: 4.6 });
      throw new Error('expected the converter to reject this document');
    } catch (error) {
      if (!(error instanceof DocumentShapeError)) throw error;

      expect(error.direction).toBe('write');
      expect(error.collection).toBe('products');
      // `toFirestore` receives only data, so the ID is genuinely unknown here and is
      // named as such rather than guessed.
      expect(error.documentId).toBe('(new)');
    }
  });

  it('rejects a FieldValue sentinel', () => {
    // A sentinel is a marker the backend resolves, not a value, so no schema can
    // validate it — and a converter that let sentinels through would validate nothing
    // on any write that used one. Server time is resolved by `now()` instead.
    expect(() =>
      converters.warehouses.toFirestore({
        ...aWarehouse(),
        updatedAt: FieldValue.serverTimestamp() as unknown as Date,
      }),
    ).toThrow(DocumentShapeError);
  });
});

describe('withId', () => {
  it('attaches the Firestore ID outside the document body', () => {
    const withIdentity = withId('blr', aWarehouse());

    expect(withIdentity.id).toBe('blr');
    expect(withIdentity.name).toBe('Bengaluru hub');
  });

  it('lets the path win over a stored id field', () => {
    // A stored `id` that disagrees with its path is a document where every reader
    // picks a different winner. The path is the fact.
    const withIdentity = withId('blr', { ...aWarehouse(), id: 'stale' });

    expect(withIdentity.id).toBe('blr');
  });
});

describe('converter coverage', () => {
  it('has a converter for every collection', () => {
    // A collection with no converter is a collection somebody is reading with
    // `snapshot.data() as OrderDoc`, and a cast validates nothing.
    const covered = new Set(Object.values(CONVERTER_COLLECTIONS));

    for (const collection of Object.values(COLLECTIONS)) {
      expect(covered.has(collection)).toBe(true);
    }
  });

  it('has a converter for every subcollection', () => {
    const covered = new Set(Object.values(CONVERTER_COLLECTIONS));

    for (const subcollection of Object.values(SUBCOLLECTIONS)) {
      // `daily` is the analytics rollup subcollection, covered by `dailyAnalytics`
      // under the `analytics` name.
      if (subcollection === SUBCOLLECTIONS.daily) continue;
      expect(covered.has(subcollection)).toBe(true);
    }
  });

  it('maps every converter to a collection', () => {
    expect(Object.keys(converters).sort()).toEqual(Object.keys(CONVERTER_COLLECTIONS).sort());
  });
});
