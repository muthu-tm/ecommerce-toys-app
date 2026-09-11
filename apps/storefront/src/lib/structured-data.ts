import type { ProductDoc, VariantOption } from '@romp/contracts';
import { moneyToRupees } from '@romp/contracts';

import { locale, mediaUrl } from '@/lib/store';

/**
 * JSON-LD for a product detail page.
 *
 * Schema.org `Product` with an `Offer`, which is what Google reads for a rich result —
 * price, availability and rating in the search listing itself. It is built from the same
 * data the page renders, so the structured data cannot claim a price the page does not
 * show: a mismatch there is both a support problem and a way to get a rich result
 * suppressed.
 *
 * `availability` is a schema.org URL, derived from whether any active variant has stock —
 * the same boolean the buy box uses, never a count. `price` is the minimum active variant
 * price in major units, because that is the "from" price the listing and the PDP both
 * lead with. The currency is the store's ISO 4217 code.
 *
 * Returned as a plain object for the page to serialise into a `<script type="application/
 * ld+json">`. It is not stringified here, so a test can assert against its shape rather
 * than parsing a string back.
 */
export interface ProductJsonLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'Product';
  readonly name: string;
  readonly description: string;
  readonly sku: string;
  readonly brand: { readonly '@type': 'Brand'; readonly name: string };
  readonly image?: readonly string[];
  readonly offers: {
    readonly '@type': 'Offer';
    readonly price: string;
    readonly priceCurrency: string;
    readonly availability: string;
    readonly url: string;
  };
  readonly aggregateRating?: {
    readonly '@type': 'AggregateRating';
    readonly ratingValue: number;
    readonly reviewCount: number;
  };
}

const IN_STOCK = 'https://schema.org/InStock';
const OUT_OF_STOCK = 'https://schema.org/OutOfStock';

export function productJsonLd(
  product: ProductDoc,
  variants: readonly VariantOption[],
  canonicalUrl: string,
): ProductJsonLd {
  const active = variants.filter((variant) => variant.active);
  const anyInStock = active.some((variant) => variant.inStock);

  // The lead price is the product's denormalised "from" minimum — the same number the
  // card and the heading show — so the three never disagree.
  const price = moneyToRupees(product.priceFromMinor).toFixed(2);

  // Cover first (order 0), resolved to absolute URLs; images with no reachable URL are
  // dropped rather than emitted as a broken link Google would fetch and fail.
  const images = [...product.media]
    .sort((left, right) => left.order - right.order)
    .flatMap((item) => {
      const url = mediaUrl(item.path);
      return url === null ? [] : [url];
    });

  // The SKU of the first active variant is representative for the product-level offer;
  // per-variant offers are a roadmap refinement, not a v1.0 need.
  const sku = active[0]?.sku ?? product.slug;

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    sku,
    brand: { '@type': 'Brand', name: product.brand },
    ...(images.length > 0 ? { image: images } : {}),
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency: locale.currency,
      availability: anyInStock ? IN_STOCK : OUT_OF_STOCK,
      url: canonicalUrl,
    },
    ...(product.ratingCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.ratingAvg,
            reviewCount: product.ratingCount,
          },
        }
      : {}),
  };
}
