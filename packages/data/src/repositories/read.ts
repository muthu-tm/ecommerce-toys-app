import type {
  FirestoreDataConverter,
  Query,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import type { StoreContext } from '../context';
import type { WithId } from '../converter';
import { withId } from '../converter';
import { splitDocumentPath } from '../paths';

/**
 * The three read shapes every repository is built from.
 *
 * Kept here so no repository writes `db.doc(path).withConverter(c).get()` itself. That
 * chain has two easy mistakes in it — forgetting the converter, so a document is
 * `snapshot.data() as OrderDoc` and validates nothing; and forgetting that
 * `snapshot.data()` is `undefined` for a missing document, so a `null` check that looks
 * like it is there is actually checking the snapshot rather than the data.
 */

/**
 * Reads one document, or null.
 *
 * `null` rather than throwing, because "absent" and "not yours" have to be
 * indistinguishable to the caller and the ownership check is what decides which error
 * to raise. A `getDocument` that threw `NotFoundError` itself would make that
 * impossible to express.
 */
export async function getDocument<T>(
  ctx: StoreContext,
  path: string,
  converter: FirestoreDataConverter<T>,
): Promise<WithId<T> | null> {
  splitDocumentPath(path);

  const snapshot = await ctx.db.doc(path).withConverter(converter).get();
  const data = snapshot.data();

  return data === undefined ? null : withId(snapshot.id, data);
}

/**
 * Reads several documents by path in one round trip.
 *
 * `getAll` rather than a loop, because a product detail page reads an inventory record
 * per variant and a loop turns that into one round trip each. Missing documents are
 * **omitted** rather than returned as nulls: every caller here is asking "which of
 * these exist", and a sparse array with holes at unpredictable indices is a shape that
 * invites an off-by-one.
 */
export async function getDocuments<T>(
  ctx: StoreContext,
  paths: readonly string[],
  converter: FirestoreDataConverter<T>,
): Promise<readonly WithId<T>[]> {
  if (paths.length === 0) return [];

  // Deduplicated because `getAll` rejects the same reference twice, and a caller
  // collecting paths from a list of order lines can legitimately produce duplicates.
  const unique = [...new Set(paths)];
  for (const path of unique) splitDocumentPath(path);

  // `Firestore.getAll` is **not** generic in this SDK — only `Transaction.getAll` is —
  // so attaching a converter to the references would be discarded and the results would
  // come back as untyped `DocumentData`. Rather than accept that, or give up the single
  // round trip and issue one `get()` per path, the references stay raw and the converter
  // is applied by hand below. Validation is preserved; only the type plumbing changes.
  const references = unique.map((path) => ctx.db.doc(path));
  const snapshots = await ctx.db.getAll(...references);

  return snapshots.flatMap((snapshot) => {
    if (!snapshot.exists) return [];

    // `fromFirestore` reads only `id` and `data()`, both of which are present on an
    // existing `DocumentSnapshot`. The cast narrows to the parameter type the SDK
    // declares rather than asserting anything about the value.
    const decoded = converter.fromFirestore(snapshot as QueryDocumentSnapshot);
    return [withId(snapshot.id, decoded)];
  });
}

/**
 * Runs a query and decodes every result.
 *
 * Deliberately has no pagination of its own. Cursor pagination needs the sort field
 * values of the last document, which only the caller knows the shape of, so paging is
 * assembled per repository rather than hidden behind a generic helper that would have
 * to guess.
 */
export async function runQuery<T>(query: Query<T>): Promise<readonly WithId<T>[]> {
  const snapshot = await query.get();

  return snapshot.docs.map((document) => withId(document.id, document.data()));
}

/**
 * Counts matching documents without reading them.
 *
 * Firestore bills an aggregation at a fraction of the documents it counts, so this is
 * how a total is obtained for a listing header. It is still a query, so it still needs
 * an index — and it still cannot produce facet counts across several dimensions at
 * once, which is why `categories.productCount` exists.
 */
export async function countQuery(query: Query): Promise<number> {
  const snapshot = await query.count().get();

  return snapshot.data().count;
}
