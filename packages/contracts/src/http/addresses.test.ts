import { describe, expect, it } from 'vitest';

import { AddressCreateRequestSchema, AddressUpdateRequestSchema } from './addresses';

/**
 * The address contracts. The concern is the boundary the routes rely on: a create carries the full
 * postal shape plus a label and default intent; an update is a non-empty partial; a bad PIN code is
 * refused before it reaches the repository.
 */

const validCreate = {
  label: 'Home',
  recipientName: 'Asha Menon',
  line1: '12 Palm Grove',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  phone: '+919845021174',
  isDefault: true,
};

describe('AddressCreateRequestSchema', () => {
  it('accepts a well-formed address', () => {
    expect(AddressCreateRequestSchema.safeParse(validCreate).success).toBe(true);
  });

  it('trims the label and requires it', () => {
    expect(AddressCreateRequestSchema.safeParse({ ...validCreate, label: '' }).success).toBe(false);
    const parsed = AddressCreateRequestSchema.parse({ ...validCreate, label: '  Home  ' });
    expect(parsed.label).toBe('Home');
  });

  it('rejects a malformed PIN code', () => {
    expect(AddressCreateRequestSchema.safeParse({ ...validCreate, pincode: '12' }).success).toBe(
      false,
    );
  });

  it('requires the default intent', () => {
    const withoutDefault = { ...validCreate };
    delete (withoutDefault as { isDefault?: boolean }).isDefault;
    expect(AddressCreateRequestSchema.safeParse(withoutDefault).success).toBe(false);
  });
});

describe('AddressUpdateRequestSchema', () => {
  it('accepts a single-field patch', () => {
    expect(AddressUpdateRequestSchema.safeParse({ label: 'Office' }).success).toBe(true);
  });

  it('accepts a promotion to default', () => {
    expect(AddressUpdateRequestSchema.safeParse({ isDefault: true }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(AddressUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a malformed PIN code in a patch', () => {
    expect(AddressUpdateRequestSchema.safeParse({ pincode: 'abc' }).success).toBe(false);
  });
});
