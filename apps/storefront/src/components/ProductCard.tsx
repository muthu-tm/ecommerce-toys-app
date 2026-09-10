import Image from 'next/image';
import Link from 'next/link';

import type { ProductSummary } from '@romp/contracts';
import { Badge, Card } from '@romp/ui';

import { formatMoney, mediaUrl, moneyFormat } from '@/lib/store';

/**
 * A product card for a listing grid or a home-page rail.
 *
 * The whole card is one link, so the tap target is the card and not just the name — on a
 * phone, a link that is only the title text is a card most of whose surface does nothing.
 *
 * Everything customer-facing here is data: the name, the price, the discount, the
 * availability, the alt text. There is no literal copy, which is what keeps the card
 * store-agnostic.
 */
export interface ProductCardProps {
  readonly product: ProductSummary;
  /**
   * True for the cards above the fold on first paint.
   *
   * Sets `priority` on the image, so the LCP image is preloaded rather than lazy-loaded.
   * Wrong in both directions is a real cost: priority on every card floods the network
   * and defeats itself, and priority on none delays the largest paint. So the caller — the
   * grid, which knows the row — decides, and the default is the safe one (lazy).
   */
  readonly priority?: boolean;
  /**
   * The `sizes` attribute, describing how wide the image renders at each breakpoint so
   * the browser fetches the right resolution. Defaults to the listing grid's columns; a
   * rail passes its own.
   */
  readonly sizes?: string;
}

/** The listing grid: 1 column on a phone, 2 on a tablet, 4 on a desktop. */
const GRID_SIZES = '(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw';

export function ProductCard({ product, priority = false, sizes = GRID_SIZES }: ProductCardProps) {
  const image = mediaUrl(product.cover?.path ?? null);
  const price = formatMoney(product.priceFromMinor, moneyFormat);
  const hasDiscount = product.mrpFromMinor > product.priceFromMinor;

  return (
    <Card interactive className="h-full overflow-hidden">
      <Link
        href={`/p/${product.slug}`}
        className="flex h-full flex-col focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {/*
          A fixed aspect-ratio box, so the card reserves its space before the image loads
          and the grid does not reflow — the single biggest source of layout shift on a
          listing page. `bg-surface-alt` is the placeholder for a product with no
          photography yet, which is every product on a freshly seeded store.
        */}
        <div className="relative aspect-square w-full overflow-hidden bg-surface-alt">
          {image === null ? (
            <span
              aria-hidden="true"
              className="flex h-full w-full items-center justify-center font-display text-2xl text-text-muted"
            >
              {product.name.slice(0, 1)}
            </span>
          ) : (
            <Image
              src={image}
              alt={product.cover?.alt ?? product.name}
              fill
              sizes={sizes}
              priority={priority}
              className="object-cover"
              // A blurred placeholder while the image loads, when the resize Function has
              // produced one. Without it there is a flash of empty surface; with a
              // non-null blurhash Next paints the blur immediately.
              {...(product.cover?.blurhash != null
                ? { placeholder: 'blur' as const, blurDataURL: product.cover.blurhash }
                : {})}
            />
          )}

          {product.badge !== null && (
            <span className="absolute top-2 left-2">
              <Badge tone="accent">{product.badge}</Badge>
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1 p-4">
          <p className="font-body text-xs tracking-wide text-text-muted uppercase">
            {product.brand}
          </p>
          <h3 className="font-display text-base leading-snug text-text-primary">{product.name}</h3>

          <div className="mt-auto flex items-baseline gap-2 pt-2">
            <span className="font-body text-lg font-bold text-text-primary">{price}</span>
            {hasDiscount && (
              <span className="font-body text-sm text-text-muted line-through">
                {formatMoney(product.mrpFromMinor, moneyFormat)}
              </span>
            )}
          </div>

          {/*
            Availability is text, not only a colour: "Out of stock" reads to a screen
            reader and to someone who cannot distinguish the muted tone. An in-stock
            product says nothing — the price and the add action carry that state.
          */}
          {!product.inStock && <p className="font-body text-sm text-text-muted">Out of stock</p>}
        </div>
      </Link>
    </Card>
  );
}
