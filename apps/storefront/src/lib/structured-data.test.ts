import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aProduct } from '@romp/contracts/fixtures';

import { aVariant } from '@/test-support/variant';

import { productJsonLd } from './structured-data';

const CANONICAL = 'https://shop.example.test/p/wooden-blocks';

describe('productJsonLd', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', 'https://cdn.example.test');
  });

  it('emits a Product with an Offer at the from-price in major units', () => {
    const jsonLd = productJsonLd(aProduct(), [aVariant()], CANONICAL);

    expect(jsonLd['@type']).toBe('Product');
    expect(jsonLd.name).toBe('Wooden building blocks');
    expect(jsonLd.brand.name).toBe('Woodwise');
    expect(jsonLd.offers.price).toBe('1299.00');
    expect(jsonLd.offers.priceCurrency).toBe('INR');
    expect(jsonLd.offers.url).toBe(CANONICAL);
  });

  it('marks availability InStock when any active variant has stock', () => {
    const jsonLd = productJsonLd(
      aProduct(),
      [aVariant({ inStock: false }), aVariant({ id: 'b' as ReturnType<typeof aVariant>['id'], inStock: true })],
      CANONICAL,
    );
    expect(jsonLd.offers.availability).toBe('https://schema.org/InStock');
  });

  it('marks availability OutOfStock when no active variant has stock', () => {
    const jsonLd = productJsonLd(aProduct(), [aVariant({ inStock: false })], CANONICAL);
    expect(jsonLd.offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('ignores an inactive variant when deriving availability', () => {
    const jsonLd = productJsonLd(
      aProduct(),
      [aVariant({ active: false, inStock: true })],
      CANONICAL,
    );
    // The only in-stock variant is inactive, so the offer is out of stock.
    expect(jsonLd.offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('resolves media to absolute image URLs, cover first', () => {
    const jsonLd = productJsonLd(aProduct(), [aVariant()], CANONICAL);
    expect(jsonLd.image).toEqual(['https://cdn.example.test/products/wooden-blocks/cover.webp']);
  });

  it('omits images when no media host is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', '');
    const jsonLd = productJsonLd(aProduct(), [aVariant()], CANONICAL);
    expect(jsonLd.image).toBeUndefined();
  });

  it('includes an aggregate rating only when there are ratings', () => {
    const rated = productJsonLd(aProduct(), [aVariant()], CANONICAL);
    expect(rated.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.6,
      reviewCount: 18,
    });

    const unrated = productJsonLd(
      aProduct({ ratingCount: 0, ratingAvg: 0 }),
      [aVariant()],
      CANONICAL,
    );
    expect(unrated.aggregateRating).toBeUndefined();
  });

  it('serialises to valid JSON with escaped values', () => {
    // A product name with a quote must not break the ld+json script.
    const jsonLd = productJsonLd(
      aProduct({ name: 'The "Big" Set' }),
      [aVariant()],
      CANONICAL,
    );
    const serialised = JSON.stringify(jsonLd);
    expect(() => {
      JSON.parse(serialised);
    }).not.toThrow();
    const parsed = JSON.parse(serialised) as { name: string };
    expect(parsed.name).toBe('The "Big" Set');
  });
});
