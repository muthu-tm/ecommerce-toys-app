import Link from 'next/link';

import type { ProductSummary } from '@romp/contracts';
import { Section } from '@romp/ui';

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

  const action =
    seeAllHref === undefined ? undefined : (
      <Link
        href={seeAllHref}
        className="inline-flex items-center gap-1 font-body text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        See all
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true" fill="none">
          <path
            d="M7 4l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    );

  return (
    // The heading id is preserved so the section's labelling contract is unchanged; Section
    // owns the header row, and the "See all" affordance sits in its action slot.
    <Section title={<span id={headingId}>{title}</span>} action={action} aria-labelledby={headingId}>
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
    </Section>
  );
}
