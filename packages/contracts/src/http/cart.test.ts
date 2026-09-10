import { describe, expect, it } from 'vitest';

import { AddCartItemRequestSchema, CartViewSchema, UpdateCartRequestSchema } from './cart';

/**
 * The cart wire contracts. The concern is the boundary rules the routes rely on: a mutation
 * carries a variant, a positive quantity and a mode — never a price — and the cart view is a
 * self-contained render with display-only totals.
 */

const addBody = {
  productId: 'wooden-blocks',
  variantId: 'WB-240',
  qty: 2,
  mode: 'add' as const,
};

describe('AddCartItemRequestSchema', () => {
  it('accepts an add with a variant and a positive quantity', () => {
    expect(AddCartItemRequestSchema.safeParse(addBody).success).toBe(true);
  });

  it('accepts a set mode', () => {
    expect(AddCartItemRequestSchema.safeParse({ ...addBody, mode: 'set' }).success).toBe(true);
  });

  it('rejects a zero or negative quantity', () => {
    expect(AddCartItemRequestSchema.safeParse({ ...addBody, qty: 0 }).success).toBe(false);
    expect(AddCartItemRequestSchema.safeParse({ ...addBody, qty: -1 }).success).toBe(false);
  });

  it('rejects a fractional quantity', () => {
    expect(AddCartItemRequestSchema.safeParse({ ...addBody, qty: 1.5 }).success).toBe(false);
  });

  it('rejects an unknown mode', () => {
    expect(AddCartItemRequestSchema.safeParse({ ...addBody, mode: 'delete' }).success).toBe(false);
  });

  it('rejects a body carrying a price — the client cannot choose it', () => {
    const withPrice = { ...addBody, priceMinor: 1 };
    const result = AddCartItemRequestSchema.safeParse(withPrice);
    // The extra key is stripped, not accepted as a price the server would trust.
    expect(result.success).toBe(true);
    if (result.success) expect('priceMinor' in result.data).toBe(false);
  });
});

describe('UpdateCartRequestSchema', () => {
  it('accepts a gift-wrap toggle', () => {
    expect(UpdateCartRequestSchema.safeParse({ giftWrap: true }).success).toBe(true);
  });

  it('rejects a missing flag', () => {
    expect(UpdateCartRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('CartViewSchema', () => {
  it('accepts a rendered cart with a line and display totals', () => {
    const view = {
      items: [
        {
          variantId: 'WB-240',
          productId: 'wooden-blocks',
          sku: 'WB-240',
          qty: 2,
          priceMinorSnapshot: 1_29_900,
          nameSnapshot: 'Wooden blocks',
          variantNameSnapshot: '240 pieces',
          imagePathSnapshot: null,
          lineSubtotalMinor: 2_59_800,
          inStock: true,
        },
      ],
      giftWrap: false,
      itemCount: 2,
      subtotalMinor: 2_59_800,
    };
    expect(CartViewSchema.safeParse(view).success).toBe(true);
  });

  it('accepts an empty cart', () => {
    expect(
      CartViewSchema.safeParse({ items: [], giftWrap: false, itemCount: 0, subtotalMinor: 0 })
        .success,
    ).toBe(true);
  });
});
