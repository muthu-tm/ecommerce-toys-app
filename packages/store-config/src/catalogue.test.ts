import { describe, expect, it } from 'vitest';

import {
  StoreConfigError,
  loadCatalogueSeed,
  loadStoreConfig,
  validateCatalogueSeed,
} from './loader';
import { CatalogueSeedSchema } from './schema';
import type { CatalogueSeedInput, StoreConfig } from './schema';

/**
 * The seed catalogue schema, and the cross-check against the store config that the
 * schema cannot perform on its own.
 *
 * The cross-check is the part worth the most: a schema failure is a typo in a file
 * someone is already looking at, whereas an unresolvable category reference produces
 * a seeded product that no page links to and no filter finds. That symptom looks
 * like a rendering bug, and chasing it means comparing two files by hand.
 */

const romp = await loadStoreConfig('romp');

/** A minimal valid product, so each test overrides exactly the field under test. */
function aSeedProduct(
  overrides: Partial<CatalogueSeedInput['products'][number]> = {},
): CatalogueSeedInput['products'][number] {
  return {
    slug: 'test-product',
    name: 'Test product',
    description: 'A product that exists only in this test.',
    brand: 'Testing Co.',
    category: 'wooden',
    ageBand: '3-5',
    safety: {
      bisCertified: false,
      bisCertNo: null,
      bisCertExpiry: null,
      bpaFree: true,
      hasSmallParts: false,
    },
    variants: [
      {
        name: 'Standard',
        sku: 'TEST-001',
        priceMinor: 49_900,
        mrpMinor: 59_900,
        options: { size: 'standard' },
        weightGrams: 500,
        stock: { blr: 5 },
      },
    ],
    ...overrides,
  };
}

const aSeed = (
  products: readonly CatalogueSeedInput['products'][number][] = [aSeedProduct()],
): CatalogueSeedInput => ({ products: [...products] });

describe('CatalogueSeedSchema', () => {
  it('accepts a minimal catalogue and applies defaults', () => {
    const parsed = CatalogueSeedSchema.parse(aSeed());
    const product = parsed.products[0];

    expect(product).toBeDefined();
    // Defaults exist so an author writes the fields that vary and omits the rest.
    expect(product?.status).toBe('active');
    expect(product?.featured).toBe(false);
    expect(product?.badge).toBeNull();
    expect(product?.media).toEqual([]);
    expect(product?.variants[0]?.active).toBe(true);
  });

  it('rejects a catalogue with no products', () => {
    expect(CatalogueSeedSchema.safeParse({ products: [] }).success).toBe(false);
  });

  it('rejects a product with no variants — a variant is what is bought', () => {
    expect(CatalogueSeedSchema.safeParse(aSeed([aSeedProduct({ variants: [] })])).success).toBe(
      false,
    );
  });

  it('rejects an MRP below the selling price', () => {
    const product = aSeedProduct();
    const variant = product.variants[0];
    if (variant === undefined) throw new Error('fixture has no variant');
    const result = CatalogueSeedSchema.safeParse(
      aSeed([{ ...product, variants: [{ ...variant, mrpMinor: 100 }] }]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a fractional price', () => {
    // Money is paise. A decimal here is an author who thought in rupees, and
    // accepting it would silently price the product at a hundredth of the intent.
    const product = aSeedProduct();
    const variant = product.variants[0];
    if (variant === undefined) throw new Error('fixture has no variant');
    const result = CatalogueSeedSchema.safeParse(
      aSeed([{ ...product, variants: [{ ...variant, priceMinor: 499.5, mrpMinor: 599.5 }] }]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects duplicate product slugs', () => {
    const result = CatalogueSeedSchema.safeParse(aSeed([aSeedProduct(), aSeedProduct()]));
    expect(result.success).toBe(false);
  });

  it('rejects a SKU reused across two products', () => {
    // Store-wide, not per product: a SKU is what an operator reads off a box, so two
    // products sharing one makes a picking error undetectable.
    const result = CatalogueSeedSchema.safeParse(
      aSeed([aSeedProduct(), aSeedProduct({ slug: 'second-product' })]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a SKU reused within one product', () => {
    const product = aSeedProduct();
    const variant = product.variants[0];
    if (variant === undefined) throw new Error('fixture has no variant');
    const result = CatalogueSeedSchema.safeParse(
      aSeed([{ ...product, variants: [variant, { ...variant, name: 'Other' }] }]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a lowercase SKU', () => {
    const product = aSeedProduct();
    const variant = product.variants[0];
    if (variant === undefined) throw new Error('fixture has no variant');
    const result = CatalogueSeedSchema.safeParse(
      aSeed([{ ...product, variants: [{ ...variant, sku: 'test-001' }] }]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an active product whose every variant is inactive', () => {
    const product = aSeedProduct();
    const variant = product.variants[0];
    if (variant === undefined) throw new Error('fixture has no variant');
    const result = CatalogueSeedSchema.safeParse(
      aSeed([{ ...product, status: 'active', variants: [{ ...variant, active: false }] }]),
    );
    expect(result.success).toBe(false);
  });

  it('accepts a draft product whose variants are all inactive', () => {
    const product = aSeedProduct();
    const variant = product.variants[0];
    if (variant === undefined) throw new Error('fixture has no variant');
    expect(
      CatalogueSeedSchema.safeParse(
        aSeed([{ ...product, status: 'draft', variants: [{ ...variant, active: false }] }]),
      ).success,
    ).toBe(true);
  });

  it('requires a certificate number behind a BIS claim', () => {
    const result = CatalogueSeedSchema.safeParse(
      aSeed([
        aSeedProduct({
          safety: {
            bisCertified: true,
            bisCertNo: null,
            bisCertExpiry: '2029-01-01',
            bpaFree: true,
            hasSmallParts: false,
          },
        }),
      ]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a certificate expiry that is not an ISO date', () => {
    const result = CatalogueSeedSchema.safeParse(
      aSeed([
        aSeedProduct({
          safety: {
            bisCertified: true,
            bisCertNo: 'IS-1',
            bisCertExpiry: '01-01-2029',
            bpaFree: true,
            hasSmallParts: false,
          },
        }),
      ]),
    );
    expect(result.success).toBe(false);
  });
});

describe('validateCatalogueSeed, against the store config', () => {
  it('accepts references the store config satisfies', () => {
    expect(() => validateCatalogueSeed('romp', romp, aSeed())).not.toThrow();
  });

  it('rejects a category the store does not have, and lists the ones it does', () => {
    let message = '';
    try {
      validateCatalogueSeed('romp', romp, aSeed([aSeedProduct({ category: 'nope' })]));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('category "nope"');
    // Listing the valid values is the difference between a message that fixes the
    // problem and one that starts a search.
    expect(message).toContain('wooden');
  });

  it('rejects an age band the store does not have', () => {
    expect(() =>
      validateCatalogueSeed('romp', romp, aSeed([aSeedProduct({ ageBand: '13-99' })])),
    ).toThrow(/ageBand "13-99"/);
  });

  it('rejects stock against an unconfigured warehouse', () => {
    // Otherwise the seed writes an inventory total no allocation can ever draw down.
    const product = aSeedProduct();
    const variant = product.variants[0];
    if (variant === undefined) throw new Error('fixture has no variant');

    expect(() =>
      validateCatalogueSeed(
        'romp',
        romp,
        aSeed([{ ...product, variants: [{ ...variant, stock: { mumbai: 4 } }] }]),
      ),
    ).toThrow(/warehouse "mumbai"/);
  });

  it('reports every problem in one pass', () => {
    let message = '';
    try {
      validateCatalogueSeed(
        'romp',
        romp,
        aSeed([
          aSeedProduct({ category: 'nope', ageBand: '13-99' }),
          aSeedProduct({
            slug: 'second',
            category: 'also-nope',
            variants: [
              {
                name: 'Standard',
                sku: 'TEST-002',
                priceMinor: 49_900,
                mrpMinor: 59_900,
                options: { size: 'standard' },
                weightGrams: 500,
                stock: { blr: 5 },
              },
            ],
          }),
        ]),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    // A seed author fixing fourteen typos should not need fourteen runs to find them.
    expect(message).toContain('nope');
    expect(message).toContain('13-99');
    expect(message).toContain('also-nope');
  });

  it('rejects media that does not exist on disk', () => {
    expect(() =>
      validateCatalogueSeed(
        'romp',
        romp,
        aSeed([
          aSeedProduct({
            media: [{ file: 'not-there.webp', alt: 'Nothing', width: 800, height: 800 }],
          }),
        ]),
      ),
    ).toThrow(/assets\/catalogue\/not-there\.webp/);
  });

  it('can skip the asset check, for validating a config without its files', () => {
    expect(() =>
      validateCatalogueSeed(
        'romp',
        romp,
        aSeed([
          aSeedProduct({
            media: [{ file: 'not-there.webp', alt: 'Nothing', width: 800, height: 800 }],
          }),
        ]),
        { checkAssets: false },
      ),
    ).not.toThrow();
  });

  it('reports a schema failure with the field path', () => {
    let message = '';
    try {
      validateCatalogueSeed('romp', romp, { products: 'not an array' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('seed.catalogue.ts is invalid');
    expect(message).toContain('products');
  });
});

/**
 * Both real catalogues, loaded and cross-checked against their own configs.
 *
 * This is the test that actually protects the seed: it is the only one that fails
 * when someone edits a store config's categories and forgets the catalogue that
 * points at them.
 */
describe('every store in the repo has a loadable seed catalogue', () => {
  const stores: readonly [string, StoreConfig][] = [['romp', romp]];

  for (const [storeId, config] of stores) {
    it(`loads stores/${storeId}/seed.catalogue.ts`, async () => {
      const catalogue = await loadCatalogueSeed(storeId, config);
      expect(catalogue?.products.length ?? 0).toBeGreaterThan(0);
    });
  }

  it('loads the scaffold catalogue against the scaffold config', async () => {
    // `_template` is the second real configuration, so its catalogue has to be valid
    // too — otherwise the next `pnpm store:new` hands someone a seed that fails.
    const template = await loadStoreConfig('_template', { allowScaffold: true });
    const catalogue = await loadCatalogueSeed('_template', template);

    expect(catalogue?.products.length).toBe(2);
  });

  it('returns null when the store has no catalogue file', async () => {
    // Optional by design: a store importing its catalogue from elsewhere should still
    // get its warehouses, categories and settings seeded, so a missing file is a
    // legitimate state rather than an error.
    expect(await loadCatalogueSeed('does-not-exist', romp)).toBeNull();
  });
});

describe('the seeded ROMP catalogue', () => {
  it('covers the states a storefront has to render', async () => {
    const catalogue = await loadCatalogueSeed('romp', romp);
    if (catalogue === null) throw new Error('ROMP has no seed catalogue');

    const variants = catalogue.products.flatMap((product) => product.variants);

    // A seed where everything is in stock, active and published never exercises the
    // empty, draft or low-stock paths, and those are the ones that break unnoticed.
    expect(catalogue.products.some((product) => product.status === 'draft')).toBe(true);
    expect(catalogue.products.some((product) => product.featured)).toBe(true);
    expect(variants.some((variant) => Object.keys(variant.stock).length === 0)).toBe(true);
    expect(
      variants.some(
        (variant) =>
          Object.values(variant.stock).reduce((total, units) => total + units, 0) > 0 &&
          Object.values(variant.stock).reduce((total, units) => total + units, 0) <
            romp.commerce.lowStockThreshold,
      ),
    ).toBe(true);
    expect(catalogue.products.some((product) => product.variants.length > 1)).toBe(true);
  });

  it('spreads across more than one category and age band', async () => {
    const catalogue = await loadCatalogueSeed('romp', romp);
    if (catalogue === null) throw new Error('ROMP has no seed catalogue');

    expect(new Set(catalogue.products.map((product) => product.category)).size).toBeGreaterThan(3);
    expect(new Set(catalogue.products.map((product) => product.ageBand)).size).toBeGreaterThan(2);
  });
});

describe('StoreConfigError', () => {
  it('is the error type every loader failure uses', () => {
    expect(() => validateCatalogueSeed('romp', romp, {})).toThrow(StoreConfigError);
  });
});
