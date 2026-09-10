import { describe, expect, it } from 'vitest';

import {
  CreateProductRequestSchema,
  CreateVariantRequestSchema,
  InventoryAdjustRequestSchema,
  ProductStatusChangeRequestSchema,
  RegisterMediaRequestSchema,
} from './admin-catalogue';

/**
 * The backoffice catalogue wire contracts.
 *
 * These assert the boundary rules that keep an admin form from submitting a document the
 * write path would reject: the safety cross-field rules, the variant MRP floor, the media
 * content-type allow-list, and the optional-slug shape.
 */

function safety(overrides: Record<string, unknown> = {}) {
  return {
    bisCertified: false,
    bisCertNo: null,
    bisCertExpiry: null,
    bpaFree: true,
    hasSmallParts: false,
    ...overrides,
  };
}

function productBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Wooden Blocks',
    description: 'A set of sanded beechwood blocks.',
    brand: 'Woodwise',
    categoryId: 'building-sets',
    categorySlug: 'building-sets',
    ageBand: '6-8',
    badge: null,
    skills: ['spatial reasoning'],
    boxItems: ['240 blocks'],
    safety: safety(),
    seo: { title: null, description: null, index: false },
    ...overrides,
  };
}

describe('CreateProductRequestSchema', () => {
  it('accepts a body without a slug (the server derives it)', () => {
    expect(CreateProductRequestSchema.safeParse(productBody()).success).toBe(true);
  });

  it('accepts an explicit valid slug', () => {
    expect(
      CreateProductRequestSchema.safeParse(productBody({ slug: 'wooden-blocks' })).success,
    ).toBe(true);
  });

  it('rejects a malformed slug', () => {
    expect(
      CreateProductRequestSchema.safeParse(productBody({ slug: 'Wooden Blocks' })).success,
    ).toBe(false);
  });

  it('requires a certificate number when BIS certified', () => {
    const result = CreateProductRequestSchema.safeParse(
      productBody({
        safety: safety({ bisCertified: true, bisCertNo: null, bisCertExpiry: '2028-01-01' }),
      }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts a BIS claim with a number and an ISO expiry date', () => {
    const result = CreateProductRequestSchema.safeParse(
      productBody({
        safety: safety({ bisCertified: true, bisCertNo: 'BIS-1', bisCertExpiry: '2028-01-01' }),
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a non-date expiry string', () => {
    const result = CreateProductRequestSchema.safeParse(
      productBody({ safety: safety({ bisCertExpiry: 'soon' }) }),
    );
    expect(result.success).toBe(false);
  });
});

describe('CreateVariantRequestSchema', () => {
  it('accepts a variant whose MRP is at least its price', () => {
    const result = CreateVariantRequestSchema.safeParse({
      name: 'Natural',
      sku: 'WB-240',
      priceMinor: 129_900,
      mrpMinor: 149_900,
      options: { finish: 'natural' },
      active: true,
      weightGrams: 500,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a variant whose MRP is below its price', () => {
    const result = CreateVariantRequestSchema.safeParse({
      name: 'Natural',
      sku: 'WB-240',
      priceMinor: 149_900,
      mrpMinor: 129_900,
      options: {},
      active: true,
      weightGrams: 500,
    });
    expect(result.success).toBe(false);
  });
});

describe('ProductStatusChangeRequestSchema', () => {
  it('accepts a valid status', () => {
    expect(ProductStatusChangeRequestSchema.safeParse({ status: 'active' }).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(ProductStatusChangeRequestSchema.safeParse({ status: 'live' }).success).toBe(false);
  });
});

describe('RegisterMediaRequestSchema', () => {
  it('accepts an allowed image type with alt text', () => {
    expect(
      RegisterMediaRequestSchema.safeParse({ alt: 'A toy', contentType: 'image/webp' }).success,
    ).toBe(true);
  });

  it('rejects a disallowed content type (no SVG)', () => {
    expect(
      RegisterMediaRequestSchema.safeParse({ alt: 'A toy', contentType: 'image/svg+xml' }).success,
    ).toBe(false);
  });

  it('requires alt text', () => {
    expect(
      RegisterMediaRequestSchema.safeParse({ alt: '', contentType: 'image/png' }).success,
    ).toBe(false);
  });
});

describe('InventoryAdjustRequestSchema', () => {
  const adjustment = {
    warehouseId: 'blr',
    delta: 3,
    reason: 'adjustment' as const,
    note: 'Found three in the back.',
  };

  it('accepts a signed adjustment with a note', () => {
    expect(InventoryAdjustRequestSchema.safeParse(adjustment).success).toBe(true);
  });

  it('accepts a negative delta (stock removed)', () => {
    expect(InventoryAdjustRequestSchema.safeParse({ ...adjustment, delta: -2 }).success).toBe(true);
  });

  it('rejects a zero delta — a movement that moves nothing', () => {
    expect(InventoryAdjustRequestSchema.safeParse({ ...adjustment, delta: 0 }).success).toBe(false);
  });

  it('rejects a fractional delta', () => {
    expect(InventoryAdjustRequestSchema.safeParse({ ...adjustment, delta: 1.5 }).success).toBe(
      false,
    );
  });

  it('requires a note when the reason is a manual adjustment', () => {
    const result = InventoryAdjustRequestSchema.safeParse({ ...adjustment, note: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'note')).toBe(true);
    }
  });

  it('allows a reconciliation without a note (the runbook documents it)', () => {
    expect(
      InventoryAdjustRequestSchema.safeParse({
        ...adjustment,
        reason: 'reconciliation',
        note: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a system reason an operator may not select', () => {
    expect(
      InventoryAdjustRequestSchema.safeParse({ ...adjustment, reason: 'order_committed' }).success,
    ).toBe(false);
  });

  it('rejects an empty warehouse code', () => {
    expect(InventoryAdjustRequestSchema.safeParse({ ...adjustment, warehouseId: '' }).success).toBe(
      false,
    );
  });
});
