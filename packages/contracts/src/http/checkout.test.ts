import { describe, expect, it } from 'vitest';

import { CheckoutQuoteRequestSchema, CheckoutQuoteResponseSchema } from './checkout';

/**
 * The checkout-quote contracts. The concern is the boundary rules the route relies on: the request
 * carries only a delivery speed — never a cart or a price — and the response is internally
 * consistent, so a client cannot be shown a total that disagrees with its own parts.
 */

describe('CheckoutQuoteRequestSchema', () => {
  it('accepts a standard delivery speed', () => {
    expect(CheckoutQuoteRequestSchema.safeParse({ deliverySpeed: 'standard' }).success).toBe(true);
  });

  it('accepts an express delivery speed', () => {
    expect(CheckoutQuoteRequestSchema.safeParse({ deliverySpeed: 'express' }).success).toBe(true);
  });

  it('rejects an unknown delivery speed', () => {
    expect(CheckoutQuoteRequestSchema.safeParse({ deliverySpeed: 'overnight' }).success).toBe(
      false,
    );
  });

  it('rejects a missing delivery speed', () => {
    expect(CheckoutQuoteRequestSchema.safeParse({}).success).toBe(false);
  });

  it('ignores a cart or a price the client tries to smuggle in', () => {
    const result = CheckoutQuoteRequestSchema.safeParse({
      deliverySpeed: 'standard',
      totalMinor: 1,
      cart: [{ variantId: 'X', qty: 99 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('totalMinor' in result.data).toBe(false);
      expect('cart' in result.data).toBe(false);
    }
  });
});

describe('CheckoutQuoteResponseSchema', () => {
  const quote = {
    lines: [
      {
        productId: 'wooden-blocks',
        variantId: 'WB-240',
        name: 'Wooden blocks',
        variantName: '240 pieces',
        unitPriceMinor: 1_00_000,
        qty: 2,
        lineTotalMinor: 2_00_000,
      },
    ],
    giftWrap: true,
    subtotalMinor: 2_00_000,
    giftWrapMinor: 5_000,
    shippingMinor: 0,
    taxMinor: 36_900,
    totalMinor: 2_41_900,
  };

  it('accepts a consistent quote', () => {
    expect(CheckoutQuoteResponseSchema.safeParse(quote).success).toBe(true);
  });

  it('rejects a line total that is not price times quantity', () => {
    const bad = {
      ...quote,
      lines: [{ ...quote.lines[0], lineTotalMinor: 1_99_999 }],
    };
    expect(CheckoutQuoteResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a subtotal that does not sum the line totals', () => {
    expect(
      CheckoutQuoteResponseSchema.safeParse({ ...quote, subtotalMinor: 1_00_000 }).success,
    ).toBe(false);
  });

  it('rejects a total that does not sum the parts', () => {
    expect(CheckoutQuoteResponseSchema.safeParse({ ...quote, totalMinor: 2_00_000 }).success).toBe(
      false,
    );
  });

  it('rejects an empty quote — a quote is only meaningful for a non-empty cart', () => {
    expect(
      CheckoutQuoteResponseSchema.safeParse({
        ...quote,
        lines: [],
        subtotalMinor: 0,
        giftWrapMinor: 0,
        shippingMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
      }).success,
    ).toBe(false);
  });
});
