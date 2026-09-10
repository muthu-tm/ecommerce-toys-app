import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import type { z } from 'zod';

import { decodeTimestamps } from './timestamps';

/**
 * A document that failed its schema.
 *
 * Carries the collection, the document ID and the exact field paths, because the
 * three questions asked when this fires are always "which document", "which field"
 * and "read or write". A bare `ZodError` answers only the second.
 */
export class DocumentShapeError extends Error {
  readonly collection: string;
  readonly documentId: string;
  readonly direction: 'read' | 'write';
  readonly issues: readonly { readonly path: string; readonly message: string }[];

  constructor(options: {
    readonly collection: string;
    readonly documentId: string;
    readonly direction: 'read' | 'write';
    readonly error: z.ZodError;
  }) {
    const issues = options.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.'),
      message: issue.message,
    }));

    super(
      `${options.collection}/${options.documentId} failed validation on ${options.direction}:\n${issues
        .map((issue) => `  ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );

    this.name = 'DocumentShapeError';
    this.collection = options.collection;
    this.documentId = options.documentId;
    this.direction = options.direction;
    this.issues = issues;
  }
}

/**
 * Builds a validating Firestore converter for one collection.
 *
 * Both directions are validated, which is unusual and intentional:
 *
 *   - **On write**, a document that violates its own invariants never reaches
 *     Firestore. `subtotalMinor` disagreeing with the line totals is caught at the
 *     call site, where the stack trace names the code that computed it.
 *   - **On read**, a document that is already wrong fails loudly instead of
 *     propagating. This is the half that gets skipped, and it is the half that
 *     matters more: the write that corrupted a document may have shipped weeks ago,
 *     may have come from a script, or may predate the invariant existing at all.
 *     Without read validation, `order.amounts.totalMinor` is simply believed.
 *
 * The cost is a Zod parse per document read. On the pages where that could matter —
 * a 24-item listing — it is a few hundred microseconds against a Firestore round
 * trip measured in milliseconds. Being confident about what a document contains is
 * worth more than that.
 *
 * **`FieldValue` sentinels are rejected**, and that is the design.
 * `FieldValue.serverTimestamp()` is a marker the backend resolves, not a value, so no
 * schema can validate it — and a converter that let sentinels through would validate
 * nothing on any write that used one. Writes needing server time resolve it first
 * (see `now()`), which also makes the written value knowable by the code that wrote
 * it. Increments and array unions go through `update()`, which the Admin SDK does not
 * route through a converter at all.
 */
export function createConverter<TOutput, TInput = TOutput>(
  schema: z.ZodType<TOutput, TInput>,
  collection: string,
): FirestoreDataConverter<TOutput> {
  return {
    toFirestore(model): DocumentData {
      const result = schema.safeParse(model);

      if (!result.success) {
        throw new DocumentShapeError({
          collection,
          // The ID is not knowable here — `toFirestore` receives only the data — so
          // it is named as such rather than guessed. The path is in the stack.
          documentId: '(new)',
          direction: 'write',
          error: result.error,
        });
      }

      return result.data as DocumentData;
    },

    fromFirestore(snapshot: QueryDocumentSnapshot): TOutput {
      // Decode before validating: the schema expects `Date`, and the SDK hands back
      // `Timestamp`.
      const decoded = decodeTimestamps(snapshot.data());
      const result = schema.safeParse(decoded);

      if (!result.success) {
        throw new DocumentShapeError({
          collection,
          documentId: snapshot.id,
          direction: 'read',
          error: result.error,
        });
      }

      return result.data;
    },
  };
}

/** A decoded document with its Firestore ID attached. */
export type WithId<T> = T & { readonly id: string };

/**
 * Attaches a document ID to decoded data.
 *
 * The ID lives outside the document body rather than being duplicated inside it,
 * because a stored `id` field can disagree with the path it is stored at — and when
 * it does, every reader picks a different winner. The two exceptions in this data
 * model store a copy deliberately (`warehouses.code`, `paymentRefGuards.upiRef`) so a
 * query result is self-describing without its snapshot, and both are natural keys
 * that never change.
 */
export function withId<T>(id: string, data: T): WithId<T> {
  return { ...data, id };
}
