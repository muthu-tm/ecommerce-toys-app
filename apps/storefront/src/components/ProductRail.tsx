import Link from 'next/link';

import type { ProductSummary } from '@romp/contracts';

import { ProductCard } from './ProductCard';

/**
 * A horizontal rail of products for the home page.
 *
 * Scrolls horizontally on a phone and lays out as a row on a desktop, so a rail of six
 * products does not become a tall column that pushes everything below the fold. The
 * heading is passed in from config copy; the "see all" link is optional, for a rail that
 * maps to a listing page.
 *
 * Renders nothing when the rail is empty rather than an empty heading — a home page with
 * "Featured" above a blank space reads as broken, and a freshly seeded store legitimately
 * has categories with no products yet.
 */
export interface ProductRailProps {
  readonly title: string;
  readonly products: readonly ProductSummary[];
  readonly seeAllHref?: string;
  readonly headingId: string;
}

/** A rail card is ~280px wide, so the browser fetches an image scaled to that. */
const RAIL_SIZES = '280px';

export function ProductRail({ title, products, seeAllHref, headingId }: ProductRailProps) {
  if (products.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={headingId} className="font-display text-2xl text-text-primary">
          {title}
        </h2>
        {seeAllHref !== undefined && (
          <Link
            href={seeAllHref}
            className="font-body text-sm text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            See all
          </Link>
        )}
      </div>

      {/*
        A scroll-snapping row. `overflow-x-auto` with fixed-width children is the rail;
        on a wide screen the children simply do not overflow and it reads as a grid row.
      */}
      <ul className="flex snap-x gap-4 overflow-x-auto pb-2">
        {products.map((product, index) => (
          <li key={product.id} className="w-[280px] shrink-0 snap-start">
            {/* The first rail is above the fold, so its first card is a priority image. */}
            <ProductCard product={product} sizes={RAIL_SIZES} priority={index === 0} />
          </li>
        ))}
      </ul>
    </section>
  );
}
