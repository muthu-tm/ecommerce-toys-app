import { describe, expect, it } from 'vitest';

import {
  E164PhoneSchema,
  EmailSchema,
  HumanOrderIdSchema,
  IdempotencyKeySchema,
  LoginIdentifierSchema,
  PincodeSchema,
  SkuSchema,
  SlugSchema,
  UpiVpaSchema,
  UtrSchema,
} from './identifiers';
import { ActorIdSchema, StoreIdSchema, SYSTEM_ACTOR, UidSchema } from './ids';

describe('EmailSchema', () => {
  it('normalises case and surrounding whitespace', () => {
    // Treating Asha@ and asha@ as different accounts would split order history.
    expect(EmailSchema.parse('  Asha@Example.COM ')).toBe('asha@example.com');
  });

  it.each(['not-an-email', 'missing@tld', '@example.com', ''])('rejects %o', (value) => {
    expect(EmailSchema.safeParse(value).success).toBe(false);
  });

  it('rejects an address beyond the maximum length', () => {
    expect(EmailSchema.safeParse(`${'a'.repeat(250)}@example.com`).success).toBe(false);
  });
});

describe('E164PhoneSchema', () => {
  it('accepts a canonical Indian mobile number', () => {
    expect(E164PhoneSchema.parse('+919845021174')).toBe('+919845021174');
  });

  it.each([
    ['a bare national number', '9845021174'],
    ['spaces', '+91 98450 21174'],
    ['a leading zero after the plus', '+0919845021174'],
    ['punctuation', '+91-98450-21174'],
    ['too short', '+91984'],
  ])('rejects %s, which must be normalised first', (_label, value) => {
    // This schema validates the canonical form only. Converting user input is
    // normalizePhone() in @romp/core, using libphonenumber-js rather than a regex.
    expect(E164PhoneSchema.safeParse(value).success).toBe(false);
  });
});

describe('LoginIdentifierSchema', () => {
  it('accepts either an email or an E.164 number', () => {
    expect(LoginIdentifierSchema.parse('asha@example.com')).toBe('asha@example.com');
    expect(LoginIdentifierSchema.parse('+919845021174')).toBe('+919845021174');
  });

  it('rejects anything that is neither', () => {
    expect(LoginIdentifierSchema.safeParse('9845021174').success).toBe(false);
  });
});

describe('SkuSchema', () => {
  it('uppercases so one SKU cannot exist twice in different cases', () => {
    expect(SkuSchema.parse(' brk-2401 ')).toBe('BRK-2401');
  });

  it('rejects a SKU with spaces or symbols inside', () => {
    expect(SkuSchema.safeParse('BRK 2401').success).toBe(false);
    expect(SkuSchema.safeParse('BRK/2401').success).toBe(false);
  });
});

describe('UtrSchema', () => {
  it('strips whitespace and uppercases', () => {
    // This value becomes the paymentRefGuards document ID, and that document's
    // existence is what stops one UTR being used on two orders. If a space
    // survived normalisation, the guard would be bypassed by typing one.
    expect(UtrSchema.parse('4123 4567 8901')).toBe('412345678901');
    expect(UtrSchema.parse('abc123def456')).toBe('ABC123DEF456');
  });

  it('normalises different spacings of the same reference identically', () => {
    expect(UtrSchema.parse('4123 45678901')).toBe(UtrSchema.parse('412345678901'));
    expect(UtrSchema.parse(' 412345678901 ')).toBe(UtrSchema.parse('412345678901'));
  });

  it('rejects a reference that is too short or has symbols', () => {
    expect(UtrSchema.safeParse('123').success).toBe(false);
    expect(UtrSchema.safeParse('4123-4567').success).toBe(false);
  });

  it('judges length after stripping, not before', () => {
    // '   123   ' is nine characters typed and three that matter. Applying the
    // minimum before normalisation would have accepted it.
    expect(UtrSchema.safeParse('   123   ').success).toBe(false);
  });
});

describe('SlugSchema', () => {
  it('accepts hyphen-separated lowercase words', () => {
    expect(SlugSchema.parse('wooden-blocks-set')).toBe('wooden-blocks-set');
  });

  it.each(['Wooden-Blocks', 'wooden--blocks', '-wooden', 'wooden-', 'wooden blocks', ''])(
    'rejects %o',
    (value) => {
      expect(SlugSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('PincodeSchema', () => {
  it('accepts a six-digit code', () => {
    expect(PincodeSchema.parse('560001')).toBe('560001');
  });

  it.each(['012345', '56001', '5600011', '56000a'])('rejects %o', (value) => {
    expect(PincodeSchema.safeParse(value).success).toBe(false);
  });
});

describe('HumanOrderIdSchema', () => {
  it('accepts any configured store prefix, not just ROMP', () => {
    // The prefix is store configuration; hardcoding RMP would make a second
    // store's order numbers a code change.
    expect(HumanOrderIdSchema.parse('RMP-24817')).toBe('RMP-24817');
    expect(HumanOrderIdSchema.parse('TOYBOX-1000')).toBe('TOYBOX-1000');
  });

  it.each(['rmp-24817', 'RMP24817', 'RMP-123', 'R-1234'])('rejects %o', (value) => {
    expect(HumanOrderIdSchema.safeParse(value).success).toBe(false);
  });
});

describe('UpiVpaSchema', () => {
  it('accepts a VPA', () => {
    expect(UpiVpaSchema.parse('romp.store@okhdfcbank')).toBe('romp.store@okhdfcbank');
  });

  it.each(['nope', 'a@b', 'store@bank1'])('rejects %o', (value) => {
    expect(UpiVpaSchema.safeParse(value).success).toBe(false);
  });
});

describe('IdempotencyKeySchema', () => {
  it('accepts a UUID', () => {
    const key = '018f3a2b-6c1e-7a90-8b2d-4f5e6a7b8c9d';
    expect(IdempotencyKeySchema.parse(key)).toBe(key);
  });

  it('rejects a key too short to be unique in practice', () => {
    expect(IdempotencyKeySchema.safeParse('abc').success).toBe(false);
  });
});

describe('document identifiers', () => {
  it('rejects IDs Firestore cannot store', () => {
    expect(UidSchema.safeParse('').success).toBe(false);
    expect(UidSchema.safeParse('a/b').success).toBe(false);
    expect(UidSchema.safeParse('.').success).toBe(false);
    expect(UidSchema.safeParse('..').success).toBe(false);
    expect(UidSchema.safeParse('valid-uid-123').success).toBe(true);
  });

  it('constrains a store ID to a lowercase slug', () => {
    expect(StoreIdSchema.parse('romp')).toBe('romp');
    expect(StoreIdSchema.safeParse('ROMP').success).toBe(false);
    expect(StoreIdSchema.safeParse('1romp').success).toBe(false);
  });

  it('accepts either a uid or the reserved system actor', () => {
    // So an audit entry is never ambiguous about whether a person was involved.
    expect(ActorIdSchema.parse(SYSTEM_ACTOR)).toBe('system');
    expect(ActorIdSchema.parse('some-uid')).toBe('some-uid');
    expect(ActorIdSchema.safeParse('').success).toBe(false);
  });
});
