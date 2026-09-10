import { describe, expect, it } from 'vitest';

import { InstantSchema, NullableInstantSchema, instantsEqual } from './instant';

describe('InstantSchema', () => {
  it('accepts a Date', () => {
    const now = new Date('2026-03-01T09:30:00.000Z');
    expect(InstantSchema.parse(now)).toBe(now);
  });

  it('rejects an ISO string', () => {
    // Documents are decoded before validation, so a string here means a converter
    // was bypassed — which is exactly the bug worth failing on.
    expect(InstantSchema.safeParse('2026-03-01T09:30:00.000Z').success).toBe(false);
  });

  it('rejects an epoch number', () => {
    expect(InstantSchema.safeParse(1_772_357_400_000).success).toBe(false);
  });

  it('rejects an invalid Date', () => {
    // `new Date('nope')` is a Date whose every method returns NaN. Letting one
    // through means a timestamp that renders as "Invalid Date" on a product page.
    expect(InstantSchema.safeParse(new Date('nope')).success).toBe(false);
  });

  it('rejects a Firestore-shaped timestamp object', () => {
    expect(InstantSchema.safeParse({ seconds: 1_772_357_400, nanoseconds: 0 }).success).toBe(false);
  });

  it('accepts null only through the nullable form', () => {
    expect(NullableInstantSchema.parse(null)).toBeNull();
    expect(InstantSchema.safeParse(null).success).toBe(false);
  });
});

describe('instantsEqual', () => {
  it('compares by epoch value, not by reference', () => {
    // Two decodes of the same stored timestamp are different objects, so `===`
    // would report a change where there is none — and the seed's idempotency check
    // is built on this comparison.
    const iso = '2026-03-01T09:30:00.000Z';
    expect(instantsEqual(new Date(iso), new Date(iso))).toBe(true);
  });

  it('reports different instants as unequal', () => {
    expect(instantsEqual(new Date('2026-03-01T09:30:00Z'), new Date('2026-03-01T09:30:01Z'))).toBe(
      false,
    );
  });

  it('treats two absent instants as equal', () => {
    expect(instantsEqual(null, null)).toBe(true);
  });

  it('treats present and absent as unequal, in both argument orders', () => {
    const now = new Date('2026-03-01T09:30:00.000Z');
    expect(instantsEqual(now, null)).toBe(false);
    expect(instantsEqual(null, now)).toBe(false);
  });
});
