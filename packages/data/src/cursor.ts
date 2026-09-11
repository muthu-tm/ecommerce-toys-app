import type { Cursor, ProductSort } from '@romp/contracts';
import { CursorSchema } from '@romp/contracts';
import { UnsupportedQueryError } from '@romp/observability';

/**
 * Opaque pagination cursors.
 *
 * A cursor encodes the sort values of the last document on a page, plus its ID as a
 * tiebreaker. Firestore's `startAfter` takes exactly those values, so page two starts
 * where page one ended even if documents were inserted in between — which is why this
 * is cursor pagination and not `offset`, where an insert makes page two skip an item.
 *
 * **Opaque to the client, on purpose.** Today the payload is a small JSON array; after
 * the Typesense migration it will be something else entirely (ADR-0002). Because
 * clients only ever echo the value back, that change does not alter the URL contract
 * or any client code. Base64url rather than base64 so a cursor survives a query string
 * without escaping.
 *
 * **A cursor is bound to its sort.** This is the part that is easy to leave out and
 * expensive to leave out. A cursor from a price-sorted page holds a price; used against
 * a rating-sorted query, Firestore compares that price against `ratingAvg` and returns
 * a page of documents that is neither wrong-looking nor right — a plausible list, in no
 * meaningful order, with items missing. Encoding the sort and refusing a mismatch turns
 * that into a 400 the caller can see.
 */

/** Values Firestore accepts as cursor components, in their JSON-safe form. */
type EncodableValue = string | number | boolean | null;

interface CursorPayload {
  /** Schema version. A cursor issued by an older deploy must not be misread by a newer one. */
  readonly v: 1;
  /** The sort this cursor belongs to. */
  readonly s: ProductSort;
  /** Sort field values from the last document, in `orderBy` order. */
  readonly f: readonly EncodableValue[];
  /** The document ID — the final `orderBy` component, so paging is total. */
  readonly d: string;
}

const CURSOR_VERSION = 1;

function toBase64Url(json: string): string {
  return Buffer.from(json, 'utf8').toString('base64url');
}

function fromBase64Url(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

/**
 * Encodes a cursor for the last document of a page.
 *
 * `Date` values become epoch milliseconds rather than ISO strings: the decoder has to
 * hand Firestore back something it can compare against a timestamp field, and an
 * integer round-trips without a parsing step that could disagree about time zones.
 */
export function encodeCursor(
  sort: ProductSort,
  sortValues: readonly (string | number | boolean | Date | null)[],
  documentId: string,
): Cursor {
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    s: sort,
    f: sortValues.map((value) => (value instanceof Date ? value.getTime() : value)),
    d: documentId,
  };

  return CursorSchema.parse(toBase64Url(JSON.stringify(payload)));
}

export interface DecodedCursor {
  readonly sortValues: readonly EncodableValue[];
  readonly documentId: string;
}

/**
 * Decodes a cursor, and refuses one that does not belong to this query.
 *
 * Every rejection path is an `UnsupportedQueryError` — a 400 — rather than a 500,
 * because in every case the caller sent something the server cannot act on: a
 * hand-edited cursor, a bookmarked URL from a previous deploy, or a cursor carried
 * across a change of sort order by a UI that re-sorts without resetting the page.
 *
 * That last one is not hypothetical. It is the normal consequence of a sort dropdown
 * that keeps the `cursor` parameter, and without this check it produces a page that
 * looks fine and is wrong.
 */
export function decodeCursor(cursor: Cursor | string, expectedSort: ProductSort): DecodedCursor {
  let payload: unknown;

  try {
    payload = JSON.parse(fromBase64Url(cursor)) as unknown;
  } catch {
    throw new UnsupportedQueryError({
      limitation: 'malformed cursor',
      detail: 'That pagination cursor is not readable. Start from the first page.',
    });
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new UnsupportedQueryError({
      limitation: 'malformed cursor',
      detail: 'That pagination cursor is not readable. Start from the first page.',
    });
  }

  const candidate = payload as Partial<CursorPayload>;

  if (candidate.v !== CURSOR_VERSION) {
    // A cursor from a previous deploy. Its field list may not match what this version
    // orders by, so it is refused rather than guessed at.
    throw new UnsupportedQueryError({
      limitation: 'cursor version',
      detail: 'That pagination cursor is from an older version of the catalogue. Start again.',
    });
  }

  if (candidate.s !== expectedSort) {
    throw new UnsupportedQueryError({
      limitation: 'cursor sort mismatch',
      detail:
        'That pagination cursor belongs to a different sort order. Start from the first page.',
    });
  }

  if (!Array.isArray(candidate.f) || typeof candidate.d !== 'string' || candidate.d === '') {
    throw new UnsupportedQueryError({
      limitation: 'malformed cursor',
      detail: 'That pagination cursor is not readable. Start from the first page.',
    });
  }

  return { sortValues: candidate.f as readonly EncodableValue[], documentId: candidate.d };
}

/**
 * Order-list cursors.
 *
 * The admin order list has one canonical sort — newest first by `createdAt`, with the document ID as
 * the tiebreaker — so unlike the catalogue there is no sort to carry or mismatch. The cursor still
 * has to be opaque and versioned for the same reasons: a hand-edited or stale cursor is a caller
 * error a 400 explains, not a 500. The payload is the last row's `createdAt` in epoch milliseconds
 * (an integer round-trips cleanly, where an ISO string invites a timezone disagreement) and its ID.
 */
interface OrderCursorPayload {
  readonly v: 1;
  /** Last row's `createdAt` as epoch milliseconds. */
  readonly t: number;
  /** Last row's document ID — the ordering tiebreaker. */
  readonly d: string;
}

export function encodeOrderCursor(createdAt: Date, documentId: string): Cursor {
  const payload: OrderCursorPayload = { v: CURSOR_VERSION, t: createdAt.getTime(), d: documentId };
  return CursorSchema.parse(toBase64Url(JSON.stringify(payload)));
}

export interface DecodedOrderCursor {
  readonly createdAt: Date;
  readonly documentId: string;
}

export function decodeOrderCursor(cursor: Cursor | string): DecodedOrderCursor {
  let payload: unknown;
  try {
    payload = JSON.parse(fromBase64Url(cursor)) as unknown;
  } catch {
    throw new UnsupportedQueryError({
      limitation: 'malformed cursor',
      detail: 'That pagination cursor is not readable. Start from the first page.',
    });
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new UnsupportedQueryError({
      limitation: 'malformed cursor',
      detail: 'That pagination cursor is not readable. Start from the first page.',
    });
  }

  const candidate = payload as Partial<OrderCursorPayload>;
  if (candidate.v !== CURSOR_VERSION) {
    throw new UnsupportedQueryError({
      limitation: 'cursor version',
      detail: 'That pagination cursor is from an older version. Start again.',
    });
  }
  if (typeof candidate.t !== 'number' || typeof candidate.d !== 'string' || candidate.d === '') {
    throw new UnsupportedQueryError({
      limitation: 'malformed cursor',
      detail: 'That pagination cursor is not readable. Start from the first page.',
    });
  }

  return { createdAt: new Date(candidate.t), documentId: candidate.d };
}
