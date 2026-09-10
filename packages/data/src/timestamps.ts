/**
 * The Timestamp ↔ Date boundary.
 *
 * Firestore stores instants as `Timestamp`; `@romp/contracts` describes them as
 * `Date`. This module is the only place the two representations meet, so a
 * `Timestamp` never reaches application code — which matters because
 * `order.createdAt.getTime()` compiles fine against a `Date` type and throws at
 * runtime against a `Timestamp`, on the server only, in whichever route happened to
 * read that field.
 *
 * **Duck-typed, not `instanceof`.** There are two `Timestamp` classes in play — one
 * in `firebase-admin/firestore` for server reads, one in `firebase/firestore` for the
 * client SDK's realtime reads (ADR-0001) — and a value from one is not an instance of
 * the other. Worse, a bundler that fails to dedupe a single SDK produces two classes
 * from the *same* package. `instanceof` would work in tests and fail in a browser, so
 * detection is on the shape instead: an object carrying `toDate()` and numeric
 * `seconds`/`nanoseconds`.
 */

/** The structural contract this module recognises as a Firestore timestamp. */
interface TimestampLike {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate: () => Date;
}

/**
 * Values that must survive a walk untouched.
 *
 * Firestore has field types beyond scalars and maps — `GeoPoint`,
 * `DocumentReference`, `Bytes`/`Buffer`. None appear in this data model today, but
 * recursing into one and rebuilding it as a plain object would corrupt it silently,
 * so they are passed through by identity rather than reconstructed.
 */
function isOpaqueFirestoreValue(value: object): boolean {
  if (value instanceof Date) return true;
  if (ArrayBuffer.isView(value)) return true;
  if (value instanceof ArrayBuffer) return true;

  // Read through a type that admits the absence, because `Object.create(null)` has no
  // constructor at all. TypeScript types `constructor` as always present, so without
  // this the optional chain reads as dead code and lint removes the guard that stops a
  // null-prototype map from throwing.
  const named = (value as { constructor?: { name?: string } }).constructor?.name;
  return named === 'GeoPoint' || named === 'DocumentReference' || named === 'Bytes';
}

export function isTimestampLike(value: unknown): value is TimestampLike {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<TimestampLike>;
  return (
    typeof candidate.toDate === 'function' &&
    typeof candidate.seconds === 'number' &&
    typeof candidate.nanoseconds === 'number'
  );
}

/**
 * Recursively replaces every Firestore timestamp in a decoded document with a `Date`.
 *
 * Structure-preserving: arrays stay arrays, maps stay maps, key order is unchanged,
 * and anything that is not a timestamp or a container is returned by identity. That
 * last part is what makes it safe to run over a whole document rather than over a
 * hand-maintained list of timestamp field paths — a list which would silently miss
 * the next field somebody adds.
 *
 * No cycle detection, deliberately. A Firestore document is a JSON-shaped tree by
 * construction: the SDK cannot produce a cyclic value, so a guard here would be
 * dead code that implies a possibility the data model does not have.
 */
export function decodeTimestamps<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (isTimestampLike(value)) return value.toDate();

  if (Array.isArray(value)) {
    return value.map((item) => walk(item));
  }

  if (typeof value === 'object' && value !== null) {
    if (isOpaqueFirestoreValue(value)) return value;

    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = walk(nested);
    }
    return result;
  }

  return value;
}

/*
 * There is deliberately no `encodeTimestamps`.
 *
 * The Firestore SDKs already accept a `Date` wherever a timestamp field is expected
 * and convert it on write, so an encode pass would be a second implementation of
 * something the SDK does — and one that could disagree with it. Writes hand `Date`
 * values straight to the SDK.
 *
 * The asymmetry is real and worth naming: reads need decoding because the SDK returns
 * `Timestamp` and offers no way to ask it not to.
 */
