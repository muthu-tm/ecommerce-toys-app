import type { Firestore } from 'firebase-admin/firestore';

import { fixedClock } from '../clock';
import type { StoreContext } from '../context';
import { createStoreContext } from '../context';

/**
 * A Firestore double that records the query it was asked to build.
 *
 * Reached only from tests. It exists to answer one class of question that a real
 * emulator answers badly: **is the ownership filter in the query, or applied after the
 * read?**
 *
 * That distinction is invisible to an integration test. `listOrdersForUser` returns the
 * right documents either way, so an emulator test passes whether the uid is a
 * `where` clause or a `.filter()` over a page that was already fetched. Only the first is
 * correct: the second returns short pages, bills for documents the caller may not see,
 * and puts another customer's data in this process's memory. The recorder is how that
 * becomes an assertion rather than a code-review habit.
 *
 * It deliberately does **not** implement filtering. Returning the documents it was
 * given, unfiltered, keeps it from being mistaken for a Firestore substitute — an
 * assertion about *which* documents came back has to go to `infra/tests/`, against the
 * real thing.
 */

export interface RecordedClause {
  readonly kind: 'where' | 'orderBy' | 'limit' | 'startAfter' | 'count';
  readonly args: readonly unknown[];
}

export interface RecordedCollection {
  readonly path: string;
  readonly clauses: readonly RecordedClause[];
}

export interface FirestoreRecorder {
  /** Every collection query built, in order. */
  readonly collections: readonly RecordedCollection[];
  /** Every document path read by `doc()`. */
  readonly documentPaths: readonly string[];
  /** Paths read through `getAll`, which the SDK cannot type. */
  readonly batchedPaths: readonly string[];
  readonly context: StoreContext;
  /** All `where` clauses across every collection, as `[field, op, value]`. */
  readonly wheres: () => readonly unknown[][];
  /** All `orderBy` clauses across every collection. */
  readonly orderBys: () => readonly unknown[][];
}

export interface RecorderOptions {
  /** Documents every collection query and `getAll` returns, keyed by path prefix or `'*'`. */
  readonly documents?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  /** Documents point reads return, keyed by exact path. */
  readonly byPath?: Readonly<Record<string, Record<string, unknown>>>;
  readonly storeId?: string;
  readonly now?: Date;
}

const DEFAULT_NOW = new Date('2026-03-01T09:30:00.000Z');

/**
 * Builds the double and a `StoreContext` wired to it.
 *
 * Documents are supplied already **decoded** — as they would look after a converter has
 * run — and are handed back through the converter's `fromFirestore`, so a document that
 * would fail its schema still fails here. A double that skipped validation would let a
 * repository test pass against a document Firestore would have rejected.
 */
export function firestoreRecorder(options: RecorderOptions = {}): FirestoreRecorder {
  const collections: RecordedCollection[] = [];
  const documentPaths: string[] = [];
  const batchedPaths: string[] = [];

  const documentsFor = (path: string): readonly Record<string, unknown>[] =>
    options.documents?.[path] ?? options.documents?.['*'] ?? [];

  const snapshotsFor = (path: string, converter: Converter | null) =>
    documentsFor(path).map((data, index) => ({
      id: idOf(data, index),
      data: () => decode(converter, idOf(data, index), data),
    }));

  const makeCollection = (path: string) => {
    const clauses: RecordedClause[] = [];
    collections.push({ path, clauses });
    let converter: Converter | null = null;

    const chain = {
      withConverter: (candidate: Converter) => {
        converter = candidate;
        return chain;
      },
      where: (...args: readonly unknown[]) => {
        clauses.push({ kind: 'where', args });
        return chain;
      },
      orderBy: (...args: readonly unknown[]) => {
        clauses.push({ kind: 'orderBy', args });
        return chain;
      },
      startAfter: (...args: readonly unknown[]) => {
        clauses.push({ kind: 'startAfter', args });
        return chain;
      },
      limit: (...args: readonly unknown[]) => {
        clauses.push({ kind: 'limit', args });
        return chain;
      },
      get: () => Promise.resolve({ docs: snapshotsFor(path, converter) }),
      count: () => ({
        get: () => {
          clauses.push({ kind: 'count', args: [] });
          return Promise.resolve({ data: () => ({ count: documentsFor(path).length }) });
        },
      }),
    };

    return chain;
  };

  const makeDocument = (path: string) => {
    documentPaths.push(path);
    let converter: Converter | null = null;

    const reference = {
      withConverter: (candidate: Converter) => {
        converter = candidate;
        return reference;
      },
      get: () => {
        const data = options.byPath?.[path];
        const id = path.split('/').at(-1) ?? '';
        return Promise.resolve({
          id,
          exists: data !== undefined,
          data: () => (data === undefined ? undefined : decode(converter, id, data)),
        });
      },
    };

    return reference;
  };

  const db = {
    collection: makeCollection,
    doc: makeDocument,
    getAll: (...references: readonly { readonly path?: string }[]) => {
      // `Firestore.getAll` is not generic in this SDK, so `getDocuments` passes raw
      // references and applies the converter itself. The double mirrors that.
      const paths = references.map((reference) => reference.path ?? '');
      batchedPaths.push(...paths);

      return Promise.resolve(
        paths.map((path) => {
          const data = options.byPath?.[path];
          return {
            id: path.split('/').at(-1) ?? '',
            exists: data !== undefined,
            data: () => data,
          };
        }),
      );
    },
  };

  // `doc()` on the raw db needs to expose `path`, for `getAll` to record it.
  const dbWithPaths = {
    ...db,
    doc: (path: string) => Object.assign(makeDocument(path), { path }),
  };

  return {
    collections,
    documentPaths,
    batchedPaths,
    context: createStoreContext({
      storeId: options.storeId ?? 'romp',
      db: dbWithPaths as unknown as Firestore,
      clock: fixedClock(options.now ?? DEFAULT_NOW),
    }),
    wheres: () =>
      collections.flatMap((collection) =>
        collection.clauses
          .filter((clause) => clause.kind === 'where')
          .map((clause) => [...clause.args]),
      ),
    orderBys: () =>
      collections.flatMap((collection) =>
        collection.clauses
          .filter((clause) => clause.kind === 'orderBy')
          .map((clause) => [...clause.args]),
      ),
  };
}

interface Converter {
  fromFirestore: (snapshot: { id: string; data: () => unknown }) => unknown;
}

function idOf(data: Record<string, unknown>, index: number): string {
  const id = data.__id;
  return typeof id === 'string' ? id : `doc-${String(index)}`;
}

/**
 * Runs the converter, or returns the data untouched when none was attached.
 *
 * `__id` is stripped: it is the double's way of letting a test choose a document ID, and
 * document schemas strip unknown keys anyway — but leaving it in would make the untyped
 * path behave differently from the converted one.
 */
function decode(converter: Converter | null, id: string, data: Record<string, unknown>): unknown {
  const { __id: _ignored, ...rest } = data;

  if (converter === null) return rest;

  return converter.fromFirestore({ id, data: () => rest });
}
