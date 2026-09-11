import { describe, expect, it } from 'vitest';

import { UnsupportedQueryError } from '@romp/observability';

import { decodeCursor, decodeOrderCursor, encodeCursor, encodeOrderCursor } from './cursor';

/**
 * Cursor pagination.
 *
 * The property worth the most here is the **sort binding**. A cursor from a price-sorted
 * page holds a price; used against a rating-sorted query, Firestore compares that price
 * against `ratingAvg` and returns a page that is neither obviously wrong nor right — a
 * plausible list, in no meaningful order, with items missing. Nobody reports that,
 * because nobody can see it.
 *
 * That is not a hypothetical failure. It is the normal consequence of a sort dropdown
 * that keeps the `cursor` query parameter.
 */

describe('round trip', () => {
  it('recovers the sort values and the document ID', () => {
    const cursor = encodeCursor('price_asc', [129_900], 'wooden-blocks');

    expect(decodeCursor(cursor, 'price_asc')).toEqual({
      sortValues: [129_900],
      documentId: 'wooden-blocks',
    });
  });

  it('encodes a Date as epoch milliseconds', () => {
    // The decoder has to hand Firestore something comparable to a timestamp field, and an
    // integer round-trips with no parsing step that could disagree about time zones.
    const at = new Date('2026-03-01T09:30:00.000Z');
    const decoded = decodeCursor(encodeCursor('newest', [at], 'p1'), 'newest');

    expect(decoded.sortValues).toEqual([at.getTime()]);
  });

  it('carries a null sort value', () => {
    // An unpublished product has `publishedAt: null`, and it still has to be pageable.
    const decoded = decodeCursor(encodeCursor('newest', [null], 'draft-1'), 'newest');

    expect(decoded.sortValues).toEqual([null]);
  });

  it('survives a query string without escaping', () => {
    // base64url rather than base64, so `+` and `/` never appear.
    const cursor = encodeCursor('price_desc', [999_999_999], 'a-very-long-product-slug-here');

    expect(cursor).toMatch(/^[\w-]+$/);
    expect(encodeURIComponent(cursor)).toBe(cursor);
  });

  it('is deterministic', () => {
    expect(encodeCursor('price_asc', [1_000], 'p1')).toBe(encodeCursor('price_asc', [1_000], 'p1'));
  });

  it('differs between sorts even for the same values', () => {
    // Which is what makes the mismatch detectable at all.
    expect(encodeCursor('price_asc', [1_000], 'p1')).not.toBe(
      encodeCursor('price_desc', [1_000], 'p1'),
    );
  });
});

describe('sort binding', () => {
  it('refuses a cursor issued for a different sort', () => {
    const cursor = encodeCursor('price_asc', [129_900], 'wooden-blocks');

    expect(() => decodeCursor(cursor, 'rating_desc')).toThrow(UnsupportedQueryError);
  });

  it('names the mismatch, so the caller knows to reset the page', () => {
    const cursor = encodeCursor('price_asc', [129_900], 'wooden-blocks');

    try {
      decodeCursor(cursor, 'newest');
      throw new Error('expected a refusal');
    } catch (error) {
      if (!(error instanceof UnsupportedQueryError)) throw error;
      expect(error.limitation).toBe('cursor sort mismatch');
      expect(error.message).toContain('first page');
    }
  });

  it('refuses a reversal of the same field', () => {
    // `price_asc` and `price_desc` order the same field, so the values look compatible.
    // Paging with the wrong direction walks away from the results instead of through them.
    const cursor = encodeCursor('price_asc', [129_900], 'p1');

    expect(() => decodeCursor(cursor, 'price_desc')).toThrow(UnsupportedQueryError);
  });
});

describe('malformed cursors', () => {
  it('refuses text that is not a cursor', () => {
    expect(() => decodeCursor('not-a-cursor', 'newest')).toThrow(UnsupportedQueryError);
  });

  it('refuses valid base64 that is not JSON', () => {
    expect(() =>
      decodeCursor(Buffer.from('hello', 'utf8').toString('base64url'), 'newest'),
    ).toThrow(UnsupportedQueryError);
  });

  it('refuses JSON that is not an object', () => {
    expect(() => decodeCursor(Buffer.from('42', 'utf8').toString('base64url'), 'newest')).toThrow(
      UnsupportedQueryError,
    );
  });

  it('refuses null', () => {
    expect(() => decodeCursor(Buffer.from('null', 'utf8').toString('base64url'), 'newest')).toThrow(
      UnsupportedQueryError,
    );
  });

  it('refuses a cursor from an older schema version', () => {
    // A bookmarked URL from a previous deploy. Its field list may not match what this
    // version orders by, so it is refused rather than guessed at.
    const stale = Buffer.from(JSON.stringify({ v: 0, s: 'newest', f: [1], d: 'p1' })).toString(
      'base64url',
    );

    try {
      decodeCursor(stale, 'newest');
      throw new Error('expected a refusal');
    } catch (error) {
      if (!(error instanceof UnsupportedQueryError)) throw error;
      expect(error.limitation).toBe('cursor version');
    }
  });

  it('refuses a cursor with no field values', () => {
    const broken = Buffer.from(JSON.stringify({ v: 1, s: 'newest', d: 'p1' })).toString(
      'base64url',
    );

    expect(() => decodeCursor(broken, 'newest')).toThrow(UnsupportedQueryError);
  });

  it('refuses a cursor with no document ID', () => {
    // Without the ID the final ordering component is missing, so paging through a tie
    // either repeats or skips documents.
    const broken = Buffer.from(JSON.stringify({ v: 1, s: 'newest', f: [1], d: '' })).toString(
      'base64url',
    );

    expect(() => decodeCursor(broken, 'newest')).toThrow(UnsupportedQueryError);
  });

  it('reports every malformed case as a 400, not a 500', () => {
    // In every case the caller sent something the server cannot act on — a hand-edited
    // cursor, or a bookmark from a previous deploy. Neither is a server fault.
    try {
      decodeCursor('garbage', 'newest');
      throw new Error('expected a refusal');
    } catch (error) {
      if (!(error instanceof UnsupportedQueryError)) throw error;
      expect(error.code).toBe('UNSUPPORTED_QUERY');
    }
  });
});

describe('order-list cursor', () => {
  it('round-trips the createdAt instant and the document ID', () => {
    const at = new Date('2026-03-01T09:30:00.000Z');
    const decoded = decodeOrderCursor(encodeOrderCursor(at, 'order-1'));

    expect(decoded.createdAt.getTime()).toBe(at.getTime());
    expect(decoded.documentId).toBe('order-1');
  });

  it('is opaque and survives a query string without escaping', () => {
    const cursor = encodeOrderCursor(new Date('2026-03-01T09:30:00.000Z'), 'order-1');
    expect(cursor).toMatch(/^[\w-]+$/);
  });

  it('is deterministic', () => {
    const at = new Date('2026-03-01T09:30:00.000Z');
    expect(encodeOrderCursor(at, 'order-1')).toBe(encodeOrderCursor(at, 'order-1'));
  });

  it('refuses a hand-edited cursor with a 400', () => {
    expect(() => decodeOrderCursor('not-a-real-cursor')).toThrow(UnsupportedQueryError);
  });

  it('refuses a cursor from a different schema — a catalogue cursor is not an order cursor', () => {
    // A product cursor encodes a sort tag and a field array, not an order's `t`/`d` shape.
    const productCursor = encodeCursor('price_asc', [129_900], 'wooden-blocks');
    expect(() => decodeOrderCursor(productCursor)).toThrow(UnsupportedQueryError);
  });
});
