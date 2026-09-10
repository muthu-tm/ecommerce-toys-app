import { describe, expect, it } from 'vitest';

import type { MediaItem } from '@romp/contracts';
import { money } from '@romp/contracts';

import type { VariantForSummary } from './product-write';
import {
  canBeActive,
  normaliseMediaOrder,
  productSearchParts,
  resolveStatusTransition,
  summariseVariants,
} from './product-write';

function variant(overrides: Partial<VariantForSummary> = {}): VariantForSummary {
  return {
    variantId: 'v-1',
    name: 'Natural',
    sku: 'SKU-1',
    priceMinor: money(1_29_900),
    mrpMinor: money(1_49_900),
    active: true,
    inStock: true,
    ...overrides,
  };
}

function media(order: number, path = `products/p/${String(order)}.webp`): MediaItem {
  return { path, alt: 'A toy', width: 1000, height: 1000, blurhash: null, order };
}

describe('summariseVariants', () => {
  it('takes the from-price as the minimum across active variants', () => {
    const pricing = summariseVariants([
      variant({ variantId: 'v-1', priceMinor: money(2_00_000), mrpMinor: money(2_50_000) }),
      variant({ variantId: 'v-2', priceMinor: money(1_00_000), mrpMinor: money(1_20_000) }),
    ]);

    expect(pricing.priceFromMinor).toBe(1_00_000);
    expect(pricing.mrpFromMinor).toBe(1_20_000);
    expect(pricing.variantSummary).toHaveLength(2);
  });

  it('ignores inactive variants when computing the headline price', () => {
    const pricing = summariseVariants([
      variant({ variantId: 'v-1', priceMinor: money(2_00_000), active: true }),
      variant({ variantId: 'v-2', priceMinor: money(50_000), active: false }),
    ]);

    // The cheaper variant is inactive, so it must not set the "from" price a card shows.
    expect(pricing.priceFromMinor).toBe(2_00_000);
  });

  it('falls back across all variants when none is active, never zero', () => {
    const pricing = summariseVariants([
      variant({ variantId: 'v-1', priceMinor: money(80_000), active: false }),
      variant({ variantId: 'v-2', priceMinor: money(90_000), active: false }),
    ]);

    // A draft mid-edit with only inactive variants still shows a real price, not free.
    expect(pricing.priceFromMinor).toBe(80_000);
  });

  it('is zero only when there are no variants at all', () => {
    const pricing = summariseVariants([]);

    expect(pricing.priceFromMinor).toBe(0);
    expect(pricing.variantSummary).toEqual([]);
  });

  it('carries each variant through to the summary', () => {
    const pricing = summariseVariants([variant({ variantId: 'v-9', inStock: false })]);

    expect(pricing.variantSummary[0]).toMatchObject({ variantId: 'v-9', inStock: false });
  });
});

describe('canBeActive', () => {
  it('is true when at least one variant is active', () => {
    expect(canBeActive([variant({ active: false }), variant({ active: true })])).toBe(true);
  });

  it('is false when every variant is inactive', () => {
    expect(canBeActive([variant({ active: false })])).toBe(false);
    expect(canBeActive([])).toBe(false);
  });
});

describe('normaliseMediaOrder', () => {
  it('rewrites order to a contiguous sequence preserving intent', () => {
    const result = normaliseMediaOrder([media(5), media(2), media(9)]);

    expect(result.map((item) => item.order)).toEqual([0, 1, 2]);
    // The item the operator ranked lowest becomes the cover.
    expect(result[0]?.path).toBe('products/p/2.webp');
  });

  it('resolves duplicate order values into a single unambiguous cover', () => {
    const result = normaliseMediaOrder([media(0, 'a.webp'), media(0, 'b.webp')]);

    expect(result.map((item) => item.order)).toEqual([0, 1]);
    expect(new Set(result.map((item) => item.order)).size).toBe(2);
  });

  it('returns an empty array unchanged', () => {
    expect(normaliseMediaOrder([])).toEqual([]);
  });
});

describe('resolveStatusTransition', () => {
  const NOW = new Date('2026-03-01T09:30:00.000Z');

  it('stamps publishedAt on first publish', () => {
    const result = resolveStatusTransition('draft', 'active', null, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.status).toBe('active');
      expect(result.transition.publishedAt).toEqual(NOW);
    }
  });

  it('retains the original publishedAt on a later publish', () => {
    const firstPublish = new Date('2026-01-01T00:00:00.000Z');
    // draft -> active again after a spell in draft: keep the original date.
    const result = resolveStatusTransition('draft', 'active', firstPublish, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transition.publishedAt).toEqual(firstPublish);
  });

  it('keeps publishedAt when unpublishing to draft', () => {
    const published = new Date('2026-01-01T00:00:00.000Z');
    const result = resolveStatusTransition('active', 'draft', published, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transition.publishedAt).toEqual(published);
  });

  it('rejects the illegal archived -> active transition with the allowed targets', () => {
    const result = resolveStatusTransition('archived', 'active', null, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('illegal_transition');
      // archived can only return to draft.
      expect(result.allowed).toEqual(['draft']);
    }
  });
});

describe('productSearchParts', () => {
  it('includes name, brand, category and age band but not the description', () => {
    const parts = productSearchParts({
      name: 'Wooden Blocks',
      brand: 'Kaadu',
      categoryName: 'Wooden Toys',
      ageBandLabel: '3-5 years',
    });

    expect(parts).toEqual(['Wooden Blocks', 'Kaadu', 'Wooden Toys', '3-5 years']);
  });
});
