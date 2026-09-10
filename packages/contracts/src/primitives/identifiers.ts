import { z } from 'zod';

/**
 * Human-facing identifiers and the normalisation rules that make them comparable.
 *
 * Normalisation is not cosmetic here. A mobile number is a **login credential**
 * (ADR-0006), so if two code paths disagree about whether `98450 21174` and
 * `+919845021174` are the same string, one customer ends up with two accounts —
 * or, worse, one customer's login reaches another's account. Every identifier that
 * participates in identity or uniqueness therefore has exactly one canonical form,
 * defined once, here.
 */

/**
 * An email address, lowercased.
 *
 * Lowercasing the whole address is technically a liberty — the local part is
 * case-sensitive per RFC 5321 — but every mail provider a retail customer will use
 * treats it case-insensitively, and treating `Asha@` and `asha@` as different
 * accounts would confuse customers and split their order history. The trade is
 * deliberate.
 */
export const EmailSchema = z
  .string()
  // Normalise *before* validating. The other order rejects a pasted address with
  // trailing whitespace, which is a routine way for a real customer to fail to
  // register.
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email({ error: 'Enter a valid email address.' })
      .max(254, { error: 'That email address is too long.' }),
  )
  .brand<'Email'>();
export type Email = z.infer<typeof EmailSchema>;

/**
 * A mobile number in E.164 form, e.g. `+919845021174`.
 *
 * This schema validates the **canonical** form only; it deliberately does not
 * accept the many shapes a customer might type. Converting user input to E.164 is
 * `normalizePhone()` in `@romp/core`, which uses libphonenumber-js rather than a
 * regular expression — a regex that accepts one set of formats will disagree with
 * a regex that accepts another, and disagreement here means duplicate accounts.
 */
export const E164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, {
    error: 'A phone number must be in E.164 form, e.g. +919845021174.',
  })
  .brand<'E164Phone'>();
export type E164Phone = z.infer<typeof E164PhoneSchema>;

/** Which identifier is a given account's login credential. */
export const IdentifierTypeSchema = z.enum(['email', 'phone']);
export type IdentifierType = z.infer<typeof IdentifierTypeSchema>;

/**
 * A login identifier: an email address or an E.164 mobile number.
 *
 * The document ID of `identityIndex` is this value, which is why it is a single
 * type rather than two nullable fields — uniqueness has to be enforced across both
 * spaces at once.
 */
export const LoginIdentifierSchema = z.union([EmailSchema, E164PhoneSchema]);
export type LoginIdentifier = z.infer<typeof LoginIdentifierSchema>;

/** URL slug: lowercase, hyphen-separated, no leading, trailing or doubled hyphens. */
export const SlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: 'A slug is lowercase words separated by single hyphens, e.g. "wooden-blocks".',
  })
  .brand<'Slug'>();
export type Slug = z.infer<typeof SlugSchema>;

/** Stock-keeping unit. Uppercased so `brk-2401` and `BRK-2401` cannot both exist. */
export const SkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(1, { error: 'A SKU cannot be empty.' })
      .max(64)
      .regex(/^[A-Z0-9][A-Z0-9._-]*$/, {
        error: 'A SKU is alphanumeric with dots, dashes or underscores.',
      }),
  )
  .brand<'Sku'>();
export type Sku = z.infer<typeof SkuSchema>;

/** Indian postal code: six digits, never starting with zero. */
export const PincodeSchema = z
  .string()
  .regex(/^[1-9]\d{5}$/, { error: 'Enter a valid 6-digit PIN code.' })
  .brand<'Pincode'>();
export type Pincode = z.infer<typeof PincodeSchema>;

/**
 * The customer-facing order number, e.g. `RMP-24817`.
 *
 * The prefix comes from store configuration, so this pattern stays generic rather
 * than hardcoding `RMP` — a second store gets its own prefix without a code
 * change (ADR-0005). Distinct from the Firestore document ID, which is random:
 * a guessable sequence must not address a document.
 */
export const HumanOrderIdSchema = z
  .string()
  .regex(/^[A-Z]{2,8}-\d{4,12}$/, {
    error: 'An order number looks like "RMP-24817".',
  })
  .brand<'HumanOrderId'>();
export type HumanOrderId = z.infer<typeof HumanOrderIdSchema>;

/**
 * A UPI transaction reference (UTR), normalised by uppercasing and stripping
 * spaces.
 *
 * Normalisation is the whole point: this value becomes the document ID of
 * `paymentRefGuards`, and that document's existence is what makes one UTR unusable
 * across two orders. If `1234 5678` and `12345678` normalised differently, the
 * guard would be trivially bypassed by adding a space.
 *
 * Length is loose because banks and PSPs differ — 12 digits is common, but
 * alphanumeric references occur. Being strict here would reject a genuine payment,
 * which is worse than accepting an odd-looking one an admin will eyeball anyway.
 */
export const UtrSchema = z
  .string()
  .max(128, { error: 'That payment reference is too long.' })
  // Interior spaces are stripped, not just surrounding ones — bank apps often
  // display a reference in groups of four. Normalise first, then apply the length
  // bound, so `"   123   "` is judged on the three characters that survive rather
  // than the nine that were typed.
  .transform((value) => value.replaceAll(/\s+/gu, '').toUpperCase())
  .pipe(
    z
      .string()
      .min(6, { error: 'A payment reference is at least 6 characters.' })
      .max(64)
      .regex(/^[A-Z0-9]+$/, {
        error: 'A payment reference contains only letters and digits.',
      }),
  )
  .brand<'Utr'>();
export type Utr = z.infer<typeof UtrSchema>;

/** A UPI virtual payment address, e.g. `store@okhdfcbank`. */
export const UpiVpaSchema = z
  .string()
  .regex(/^[\w.-]{2,64}@[A-Za-z]{2,64}$/, {
    error: 'Enter a valid UPI ID, e.g. "store@okhdfcbank".',
  })
  .brand<'UpiVpa'>();
export type UpiVpa = z.infer<typeof UpiVpaSchema>;

/**
 * Correlation ID for a single request, echoed as `x-request-id` and attached to
 * every log line and error response it produces.
 */
export const CorrelationIdSchema = z.string().min(1).max(128).brand<'CorrelationId'>();
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;

/**
 * Idempotency key supplied by a client on money-critical POSTs.
 *
 * Required on order placement and payment-proof submission, where a retry would
 * otherwise double-reserve stock or double-claim a payment reference. A UUID is
 * expected; the length bound is what actually matters, since the key becomes part
 * of a stored record.
 */
export const IdempotencyKeySchema = z
  .string()
  .min(8, { error: 'An idempotency key is at least 8 characters.' })
  .max(128)
  .brand<'IdempotencyKey'>();
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
