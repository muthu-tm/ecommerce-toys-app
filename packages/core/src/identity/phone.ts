import type { CountryCode } from 'libphonenumber-js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { E164PhoneSchema, EmailSchema } from '@romp/contracts';
import type { E164Phone, Email, IdentifierType } from '@romp/contracts';

/**
 * Identity normalisation, shared verbatim by browser and server.
 *
 * The single most important property of this module: the client that derives a login
 * alias and the server that creates the Auth user must agree, byte for byte, about what
 * a given identifier maps to. If they disagree, a customer either cannot sign in with the
 * number they registered, or — far worse — one customer's login reaches another's account.
 * Agreement is guaranteed here by there being exactly one implementation, imported by
 * both, with no configuration that differs between them beyond the explicit default region.
 *
 * See ADR-0006 for why this is password-plus-alias rather than a phone provider.
 */

/** Thrown when a string cannot be parsed as a phone number for the given region. */
export class InvalidPhoneNumberError extends Error {
  constructor(message = 'That does not look like a valid mobile number.') {
    super(message);
    this.name = 'InvalidPhoneNumberError';
  }
}

/**
 * Whether a raw identifier is an email or a phone number.
 *
 * The test is the presence of an `@`, not a full email parse: a phone number never
 * contains one, and anything containing one is the customer's attempt at an email, which
 * the email validator then accepts or rejects with a useful message. Classifying an
 * `@`-bearing string as a phone number would send it to the phone parser and produce a
 * confusing "invalid mobile number" for what is plainly a mistyped email.
 */
export function classifyIdentifier(raw: string): IdentifierType {
  return raw.includes('@') ? 'email' : 'phone';
}

/**
 * Normalises a mobile number to E.164, or throws.
 *
 * A bare national number (`9845021174`) is interpreted using `defaultRegion`, which comes
 * from `locale.defaultPhoneRegion` in store config — so a store operating outside India
 * changes one config value rather than any code. A number written with its country code
 * (`+91…`, `0091…`) is region-independent and parses regardless.
 *
 * Parsing is delegated to libphonenumber-js because phone-number validity is not a regular
 * language: length, prefixes and area codes vary by country and change over time, and any
 * regex that looks right will disagree with another regex that also looks right. That
 * disagreement is exactly what produces duplicate accounts.
 */
export function normalizePhone(raw: string, defaultRegion: string): E164Phone {
  const trimmed = raw.trim();
  if (trimmed === '') throw new InvalidPhoneNumberError();

  const parsed = parsePhoneNumberFromString(trimmed, defaultRegion as CountryCode);
  if (!parsed?.isValid()) {
    throw new InvalidPhoneNumberError();
  }

  // `.number` is the E.164 string. Re-validate through the schema so the branded type is
  // honestly obtained rather than asserted — and so a future libphonenumber change that
  // produced a non-E.164 string would fail here rather than downstream.
  return E164PhoneSchema.parse(parsed.number);
}

/**
 * Normalises an email address to its canonical (trimmed, lowercased) form, or throws.
 *
 * Wraps `EmailSchema` so the two identifier paths have symmetric functions — a caller
 * normalises whichever kind it classified and gets a branded value or an error, without
 * reaching into the contracts package directly.
 */
export function normalizeEmail(raw: string): Email {
  return EmailSchema.parse(raw);
}

/** The non-routable domain used for phone-alias login emails: `auth.<brand>.internal`. */
export function aliasDomain(brandSlug: string): string {
  return `auth.${brandSlug}.internal`;
}

/**
 * Derives the Firebase Auth login email for a normalised phone number.
 *
 * Firebase Auth has no mobile-plus-password provider, so mobile identity is built on a
 * deterministic alias: `p.<digits>@auth.<brand>.internal`. The domain is non-routable on
 * purpose — it is an identifier, never an address, and nothing is ever sent to it.
 *
 * The digits are the E.164 number with its leading `+` stripped, so `+919845021174`
 * becomes `p.919845021174@…`. This is a pure function of the normalised number, which is
 * why every spelling that normalises to the same E.164 reaches the same alias and thus the
 * same account.
 */
export function toAuthEmail(phone: E164Phone, brandSlug: string): string {
  const digits = phone.replace(/^\+/u, '');
  return `p.${digits}@${aliasDomain(brandSlug)}`;
}
