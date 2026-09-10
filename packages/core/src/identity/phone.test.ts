import { describe, expect, it } from 'vitest';

import { E164PhoneSchema } from '@romp/contracts';

import {
  InvalidPhoneNumberError,
  aliasDomain,
  classifyIdentifier,
  normalizeEmail,
  normalizePhone,
  toAuthEmail,
} from './phone';

const IN = 'IN';

describe('classifyIdentifier', () => {
  it('treats an @-bearing string as an email', () => {
    expect(classifyIdentifier('aditi@example.com')).toBe('email');
  });

  it('treats a digit string as a phone', () => {
    expect(classifyIdentifier('9845021174')).toBe('phone');
  });

  it('classifies a mistyped email as email, not phone, so the error is useful', () => {
    // Sending this to the phone parser would produce a confusing "invalid mobile number".
    expect(classifyIdentifier('not-an-email@')).toBe('email');
  });
});

describe('normalizePhone', () => {
  // Every spelling a customer might type must reach one canonical E.164 (IDENTITY.md).
  const spellings = [
    '9845021174',
    '098450 21174',
    '+91 98450 21174',
    '+91-98450-21174',
    '0091 9845021174',
  ];

  it.each(spellings)('normalises %s to +919845021174', (input) => {
    expect(normalizePhone(input, IN)).toBe('+919845021174');
  });

  it('produces a value the E.164 schema accepts', () => {
    const normalised = normalizePhone('9845021174', IN);
    expect(E164PhoneSchema.safeParse(normalised).success).toBe(true);
  });

  it('uses the default region for a bare national number', () => {
    // A US number under a US default region.
    expect(normalizePhone('(213) 373-4253', 'US')).toBe('+12133734253');
  });

  it('rejects an empty string', () => {
    expect(() => normalizePhone('   ', IN)).toThrow(InvalidPhoneNumberError);
  });

  it('rejects junk', () => {
    expect(() => normalizePhone('not a number', IN)).toThrow(InvalidPhoneNumberError);
  });

  it('rejects a too-short number', () => {
    expect(() => normalizePhone('12345', IN)).toThrow(InvalidPhoneNumberError);
  });

  it('rejects a number that parses to an invalid one', () => {
    // Right length, wrong shape for the region: libphonenumber parses it but isValid() is
    // false, exercising the second half of the guard rather than the "unparseable" half.
    expect(() => normalizePhone('+91 0000000000', IN)).toThrow(InvalidPhoneNumberError);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Aditi@Example.COM ')).toBe('aditi@example.com');
  });

  it('throws on an invalid address', () => {
    expect(() => normalizeEmail('not-an-email')).toThrow();
  });
});

describe('toAuthEmail', () => {
  it('derives the alias from the normalised number', () => {
    const phone = normalizePhone('9845021174', IN);
    expect(toAuthEmail(phone, 'romp')).toBe('p.919845021174@auth.romp.internal');
  });

  it('maps every spelling to the same alias', () => {
    const a = toAuthEmail(normalizePhone('098450 21174', IN), 'romp');
    const b = toAuthEmail(normalizePhone('+91-98450-21174', IN), 'romp');
    expect(a).toBe(b);
  });

  it('uses the brand slug in the non-routable domain', () => {
    const phone = normalizePhone('9845021174', IN);
    expect(toAuthEmail(phone, 'toybox')).toBe('p.919845021174@auth.toybox.internal');
  });
});

describe('aliasDomain', () => {
  it('is non-routable and brand-scoped', () => {
    expect(aliasDomain('romp')).toBe('auth.romp.internal');
  });
});
