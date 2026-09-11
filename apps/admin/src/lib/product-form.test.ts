import { describe, expect, it } from 'vitest';

import {
  EMPTY_PRODUCT_FORM,
  productDocToFormState,
  rupeesToPaise,
  splitList,
  statusActions,
  toCreateRequest,
  toUpdateRequest,
  toVariantRequest,
} from './product-form';
import type { ProductFormState } from './product-form';

/**
 * The product form's pure mapping.
 *
 * These assert the fiddly conversions a form gets wrong: list splitting, rupee→paise, the
 * conditional safety fields, the optional slug, and the round trip from a stored product back
 * into form state. The form component is a thin binding over this, so covering it here covers
 * the logic that matters.
 */

function filled(overrides: Partial<ProductFormState> = {}): ProductFormState {
  return {
    ...EMPTY_PRODUCT_FORM,
    name: 'Wooden Blocks',
    description: 'A set of blocks.',
    brand: 'Woodwise',
    categoryId: 'building-sets',
    categorySlug: 'building-sets',
    ageBand: '6-8',
    skills: 'balance, focus',
    boxItems: '240 blocks, bag',
    ...overrides,
  };
}

describe('splitList', () => {
  it('splits on commas and newlines, trimming and dropping blanks', () => {
    expect(splitList('a, b\nc ,  , d')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is empty for blank input', () => {
    expect(splitList('  ')).toEqual([]);
  });
});

describe('rupeesToPaise', () => {
  it('converts rupees to integer paise', () => {
    expect(rupeesToPaise('1299')).toBe(129_900);
    expect(rupeesToPaise('19.99')).toBe(1_999);
  });

  it('rejects a non-numeric or negative amount', () => {
    expect(rupeesToPaise('abc')).toBeNull();
    expect(rupeesToPaise('-5')).toBeNull();
  });
});

describe('toCreateRequest', () => {
  it('omits the slug when blank so the server derives it', () => {
    const request = toCreateRequest(filled({ slug: '' }));
    expect('slug' in request).toBe(false);
    expect(request.skills).toEqual(['balance', 'focus']);
  });

  it('includes an explicit slug when given', () => {
    const request = toCreateRequest(filled({ slug: 'wooden-blocks' }));
    expect(request.slug).toBe('wooden-blocks');
  });

  it('nulls the BIS fields when not certified', () => {
    const request = toCreateRequest(filled({ bisCertified: false, bisCertNo: 'stale' }));
    expect(request.safety.bisCertified).toBe(false);
    expect(request.safety.bisCertNo).toBeNull();
    expect(request.safety.bisCertExpiry).toBeNull();
  });

  it('keeps the BIS fields when certified', () => {
    const request = toCreateRequest(
      filled({ bisCertified: true, bisCertNo: 'BIS-1', bisCertExpiry: '2028-01-01' }),
    );
    expect(request.safety.bisCertNo).toBe('BIS-1');
    expect(request.safety.bisCertExpiry).toBe('2028-01-01');
  });

  it('maps the SEO block, nulling blank overrides', () => {
    const request = toCreateRequest(filled({ seoTitle: '', seoDescription: 'Custom', seoIndex: false }));
    expect(request.seo).toEqual({ title: null, description: 'Custom', index: false });
  });
});

describe('toUpdateRequest', () => {
  it('carries no slug (a rename is a separate action)', () => {
    const request = toUpdateRequest(filled({ slug: 'wooden-blocks' }));
    expect('slug' in request).toBe(false);
  });
});

describe('toVariantRequest', () => {
  it('converts rupee prices to paise on success', () => {
    const result = toVariantRequest({
      name: 'Natural',
      sku: 'WB-240',
      price: '1299',
      mrp: '1499',
      weightGrams: '800',
      active: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.priceMinor).toBe(129_900);
      expect(result.request.mrpMinor).toBe(149_900);
      expect(result.request.weightGrams).toBe(800);
    }
  });

  it('reports the first invalid field', () => {
    const badPrice = toVariantRequest({ name: 'N', sku: 'S', price: 'x', mrp: '1', weightGrams: '1', active: true });
    expect(badPrice).toEqual({ ok: false, field: 'price' });

    const badWeight = toVariantRequest({ name: 'N', sku: 'S', price: '1', mrp: '1', weightGrams: '0', active: true });
    expect(badWeight).toEqual({ ok: false, field: 'weightGrams' });
  });
});

describe('productDocToFormState', () => {
  it('joins lists, formats the BIS expiry date, and surfaces SEO overrides', () => {
    const state = productDocToFormState({
      name: 'Wooden Blocks',
      slug: 'wooden-blocks',
      description: 'Blocks.',
      brand: 'Woodwise',
      categoryId: 'building-sets',
      categorySlug: 'building-sets',
      ageBand: '6-8',
      badge: 'Bestseller',
      skills: ['balance', 'focus'],
      boxItems: ['240 blocks'],
      safety: {
        bisCertified: true,
        bisCertNo: 'BIS-1',
        bisCertExpiry: new Date('2028-01-01T00:00:00.000Z'),
        bpaFree: true,
        hasSmallParts: false,
      },
      seo: { title: 'Custom', description: null, index: false },
    });

    expect(state.skills).toBe('balance, focus');
    expect(state.badge).toBe('Bestseller');
    expect(state.bisCertExpiry).toBe('2028-01-01');
    expect(state.seoTitle).toBe('Custom');
    expect(state.seoDescription).toBe('');
    expect(state.seoIndex).toBe(false);
  });
});

describe('statusActions', () => {
  it('offers publish and archive from draft', () => {
    expect(statusActions('draft').map((action) => action.to)).toEqual(['active', 'archived']);
  });

  it('offers unpublish and archive from active', () => {
    expect(statusActions('active').map((action) => action.to)).toEqual(['draft', 'archived']);
  });

  it('offers only restore-to-draft from archived (no direct republish)', () => {
    expect(statusActions('archived').map((action) => action.to)).toEqual(['draft']);
  });
});
