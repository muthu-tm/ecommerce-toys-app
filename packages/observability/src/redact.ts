/**
 * Recursive PII and secret redaction, applied at serialisation time.
 *
 * The promise this keeps is from `docs/SECURITY.md`: a careless
 * `logger.info({ user })` cannot leak a customer's phone number or email. That has
 * to hold at *any* depth, because the object a developer happens to log is rarely
 * the flat shape a redaction path list anticipates — it is an order with a nested
 * contact map, or a user document inside a repository result.
 *
 * Why a recursive walk rather than pino's built-in `redact.paths`: path lists match
 * declared shapes, and a single-level wildcard cannot express "wherever `phone`
 * appears". A control that only works when you predicted the shape is not a control.
 *
 * Why this matters more here than in most systems: a mobile number is a **login
 * identifier** (ADR-0006), not just contact detail. Leaking one into a log tells an
 * attacker that an account exists and what its username is.
 */

/** Replacement written in place of a redacted value. */
export const REDACTED = '[redacted]';
const CIRCULAR = '[circular]';
const TRUNCATED = '[truncated: max depth]';

/** Default depth limit. Deep enough for real documents, shallow enough to bound cost. */
export const DEFAULT_MAX_DEPTH = 8;

/** Default array length limit, so one log line cannot dump a whole collection. */
export const DEFAULT_MAX_ARRAY_LENGTH = 100;

/**
 * Keys whose values are always removed.
 *
 * Matching is on the **normalised** key — lowercased with non-alphanumerics
 * stripped — so `phone_number`, `phoneNumber` and `PhoneNumber` are one entry.
 *
 * Exact match, not substring. Substring matching would redact `emailVerified` and
 * `hasPhone`, which are useful for debugging and disclose nothing; over-redaction
 * that hides operational signal eventually gets the whole mechanism switched off.
 * The cost is that a new PII field name has to be added here, which is why the
 * schema field names in `@romp/contracts` and this list are reviewed together.
 */
export const DEFAULT_REDACTED_KEYS: readonly string[] = Object.freeze([
  // credentials
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'secret',
  'clientsecret',
  'token',
  'idtoken',
  'accesstoken',
  'refreshtoken',
  'customtoken',
  'apikey',
  'authorization',
  'cookie',
  'setcookie',
  'otp',
  // identity — both of these are login identifiers, so they are credentials here
  'email',
  'emailaddress',
  'phone',
  'phonenumber',
  'mobile',
  'mobilenumber',
  // payment
  'utr',
  'upiref',
  'outwardupiref',
  'screenshotpath',
  'cvv',
  'cardnumber',
  // postal PII
  'shippingaddress',
  'billingaddress',
  'address',
  'line1',
  'line2',
  'recipientname',
  'pincode',
]);

export interface RedactOptions {
  /** Additional keys to redact, on top of the defaults. */
  readonly additionalKeys?: readonly string[];
  /** Keys to keep even if they are in the default list. Use sparingly and deliberately. */
  readonly allowKeys?: readonly string[];
  readonly maxDepth?: number;
  readonly maxArrayLength?: number;
}

function normaliseKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
}

/** Builds the key matcher once, so a logger does not rebuild it per line. */
export function createRedactor(options: RedactOptions = {}): (value: unknown) => unknown {
  const allowed = new Set((options.allowKeys ?? []).map(normaliseKey));
  const blocked = new Set(
    [...DEFAULT_REDACTED_KEYS, ...(options.additionalKeys ?? [])]
      .map(normaliseKey)
      .filter((key) => !allowed.has(key)),
  );
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxArrayLength = options.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH;

  const shouldRedact = (key: string): boolean => blocked.has(normaliseKey(key));

  const walk = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
    if (value === null || typeof value !== 'object') {
      return typeof value === 'bigint' ? value.toString() : value;
    }

    if (depth > maxDepth) return TRUNCATED;

    // Cycle detection tracks the *current ancestor path*, not everything seen. The
    // difference matters: an object referenced twice as siblings is shared, not
    // circular, and reporting it as circular would silently drop real data from the
    // log line. Only an object that contains itself is a cycle — and a cycle would
    // hang the logger, which takes the request with it.
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    try {
      return walkObject(value, depth, seen);
    } finally {
      seen.delete(value);
    }
  };

  const walkObject = (value: object, depth: number, seen: WeakSet<object>): unknown => {
    if (value instanceof Date) return value.toISOString();

    // Errors are the single most useful thing in a log line, and their enumerable
    // properties are usually empty, so they are handled explicitly rather than
    // serialising to `{}`.
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        ...(value.cause === undefined ? {} : { cause: walk(value.cause, depth + 1, seen) }),
      };
    }

    if (Array.isArray(value)) {
      const items = value.slice(0, maxArrayLength).map((item) => walk(item, depth + 1, seen));
      return value.length > maxArrayLength
        ? [...items, `[truncated: ${String(value.length - maxArrayLength)} more]`]
        : items;
    }

    if (value instanceof Map) {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of value) {
        const name = String(key);
        result[name] = shouldRedact(name) ? REDACTED : walk(entry, depth + 1, seen);
      }
      return result;
    }

    if (value instanceof Set) {
      return walk([...value], depth, seen);
    }

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      // Redaction is decided by key name before the value is inspected, so a
      // redacted subtree is never walked and cannot leak through a nested field.
      result[key] = shouldRedact(key) ? REDACTED : walk(entry, depth + 1, seen);
    }
    return result;
  };

  return (value: unknown) => walk(value, 0, new WeakSet());
}

/** One-shot redaction. Prefer `createRedactor` on a hot path. */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  return createRedactor(options)(value);
}
