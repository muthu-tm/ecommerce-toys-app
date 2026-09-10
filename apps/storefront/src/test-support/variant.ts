import type { VariantOption } from '@romp/contracts';

/**
 * A variant option for a PDP test.
 *
 * The buy-box tests want a `VariantOption` with its fields spelled out so an assertion
 * reads against a known value, so this builds one directly rather than deriving it from a
 * `ProductDoc` fixture.
 */
export function aVariant(overrides: Partial<VariantOption> = {}): VariantOption {
  return {
    id: 'WB-240' as VariantOption['id'],
    name: '240 pieces',
    sku: 'WB-240' as VariantOption['sku'],
    priceMinor: 129_900 as VariantOption['priceMinor'],
    mrpMinor: 149_900 as VariantOption['mrpMinor'],
    options: { size: '240' },
    active: true,
    inStock: true,
    ...overrides,
  };
}
