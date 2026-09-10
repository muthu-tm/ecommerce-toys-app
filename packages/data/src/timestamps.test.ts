import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { decodeTimestamps, isTimestampLike } from './timestamps';

/**
 * The Timestamp → Date boundary.
 *
 * The real `Timestamp` class is used here, not a stub, because the whole point of
 * duck-typing the detection is that it works against the classes that actually exist.
 * A test against a hand-rolled `{ toDate, seconds, nanoseconds }` object would pass
 * even if the real shape had changed.
 */

const iso = '2026-03-01T09:30:00.000Z';
const instant = new Date(iso);

describe('isTimestampLike', () => {
  it('recognises a real Admin SDK Timestamp', () => {
    expect(isTimestampLike(Timestamp.fromDate(instant))).toBe(true);
  });

  it('recognises a structurally identical value from another SDK copy', () => {
    // This is the case `instanceof` gets wrong: a bundler that fails to dedupe the
    // SDK produces two Timestamp classes, and a value from one is not an instance of
    // the other. It would pass in Node and fail in a browser.
    const fromElsewhere = {
      seconds: 1_772_357_400,
      nanoseconds: 0,
      toDate: () => instant,
    };
    expect(isTimestampLike(fromElsewhere)).toBe(true);
  });

  it('rejects a Date', () => {
    expect(isTimestampLike(instant)).toBe(false);
  });

  it('rejects a plain object that only looks numeric', () => {
    expect(isTimestampLike({ seconds: 1, nanoseconds: 0 })).toBe(false);
  });

  it('rejects an object whose toDate is not callable', () => {
    expect(isTimestampLike({ seconds: 1, nanoseconds: 0, toDate: 'nope' })).toBe(false);
  });

  it('rejects null and primitives', () => {
    expect(isTimestampLike(null)).toBe(false);
    expect(isTimestampLike(undefined)).toBe(false);
    expect(isTimestampLike(42)).toBe(false);
    expect(isTimestampLike('2026-03-01')).toBe(false);
  });
});

describe('decodeTimestamps', () => {
  it('converts a top-level timestamp', () => {
    const decoded = decodeTimestamps({ createdAt: Timestamp.fromDate(instant) });

    expect(decoded.createdAt).toBeInstanceOf(Date);
    expect((decoded.createdAt as unknown as Date).toISOString()).toBe(iso);
  });

  it('converts timestamps nested in maps', () => {
    const decoded = decodeTimestamps({
      payment: { verifiedAt: Timestamp.fromDate(instant), verifiedBy: 'staff-1' },
    });

    expect(decoded.payment.verifiedAt).toBeInstanceOf(Date);
    expect(decoded.payment.verifiedBy).toBe('staff-1');
  });

  it('converts timestamps inside arrays of maps', () => {
    // Order items and cart lines both carry an `addedAt` inside an array, so this is
    // not a hypothetical shape.
    const decoded = decodeTimestamps({
      items: [{ addedAt: Timestamp.fromDate(instant) }, { addedAt: Timestamp.fromDate(instant) }],
    });

    expect(decoded.items).toHaveLength(2);
    expect(decoded.items[0]?.addedAt).toBeInstanceOf(Date);
    expect(decoded.items[1]?.addedAt).toBeInstanceOf(Date);
  });

  it('converts timestamps used as map values', () => {
    // `notifications.readBy` is uid → Timestamp, so the values need walking even
    // though the keys are arbitrary.
    const decoded = decodeTimestamps({ readBy: { 'staff-1': Timestamp.fromDate(instant) } });

    expect(decoded.readBy['staff-1']).toBeInstanceOf(Date);
  });

  it('leaves nulls, numbers, strings and booleans alone', () => {
    const document = {
      readAt: null,
      totalMinor: 290_976,
      humanId: 'RMP-24817',
      isGift: false,
    };

    expect(decodeTimestamps(document)).toEqual(document);
  });

  it('preserves an existing Date rather than recursing into it', () => {
    // A Date is an object with own properties in some engines; rebuilding it as a
    // plain map would turn a timestamp into `{}`.
    const decoded = decodeTimestamps({ at: instant });

    expect(decoded.at).toBeInstanceOf(Date);
    expect(decoded.at.toISOString()).toBe(iso);
  });

  it('preserves binary data', () => {
    // Recursing into a typed array and rebuilding it as a plain map would corrupt it
    // silently, so opaque Firestore field types are passed through by identity.
    const bytes = new Uint8Array([1, 2, 3]);
    const decoded = decodeTimestamps({ blob: bytes });

    expect(decoded.blob).toBe(bytes);
  });

  it('preserves a raw ArrayBuffer', () => {
    const buffer = new ArrayBuffer(8);
    expect(decodeTimestamps({ blob: buffer }).blob).toBe(buffer);
  });

  it('preserves array shape and length', () => {
    const decoded = decodeTimestamps({ skills: ['spatial reasoning', 'fine motor'] });

    expect(Array.isArray(decoded.skills)).toBe(true);
    expect(decoded.skills).toEqual(['spatial reasoning', 'fine motor']);
  });

  it('preserves key order', () => {
    // Not cosmetic: the seed compares stored documents against desired ones, and a
    // reordered map would make an unchanged document look changed.
    const decoded = decodeTimestamps({ b: 1, a: 2, c: Timestamp.fromDate(instant) });

    expect(Object.keys(decoded)).toEqual(['b', 'a', 'c']);
  });

  it('handles an empty document, an empty array and an empty map', () => {
    expect(decodeTimestamps({})).toEqual({});
    expect(decodeTimestamps({ items: [] })).toEqual({ items: [] });
    expect(decodeTimestamps({ stock: {} })).toEqual({ stock: {} });
  });

  it('returns a primitive unchanged', () => {
    expect(decodeTimestamps(7)).toBe(7);
    expect(decodeTimestamps(null)).toBeNull();
  });

  it('walks a map with no prototype', () => {
    // `Object.create(null)` has no `constructor`, so the opaque-value check has to
    // tolerate its absence rather than reading through it.
    const bare = Object.create(null) as Record<string, unknown>;
    bare.createdAt = Timestamp.fromDate(instant);

    expect((decodeTimestamps(bare).createdAt as Date).toISOString()).toBe(iso);
  });

  it('converts a deeply nested timestamp', () => {
    const decoded = decodeTimestamps({
      a: { b: { c: [{ d: Timestamp.fromDate(instant) }] } },
    });

    expect(decoded.a.b.c[0]?.d).toBeInstanceOf(Date);
  });
});
