import type { ProductSummary } from '@romp/contracts';
import { Card, Skeleton } from '@romp/ui';

import { ProductCard } from './ProductCard';

/**
 * A responsive product grid.
 *
 * One column on a phone, two on a tablet, four on a desktop. The breakpoints are matched
 * by `ProductCard`'s default `sizes`, so the browser fetches an image scaled to the
 * column it will occupy rather than the full-width original.
 */
export interface ProductGridProps {
  readonly products: readonly ProductSummary[];
  /**
   * How many leading cards get `priority` on their image.
   *
   * The first row is the LCP candidate on a listing page, so it is preloaded; the rest
   * lazy-load. Defaulting to the desktop row width (4) is the safe over-estimate — a
   * phone shows one of them above the fold and preloads three it will scroll to, which
   * costs little, whereas priority on the whole grid floods the network.
   */
  readonly priorityCount?: number;
}

const DEFAULT_PRIORITY_ROW = 4;

export function ProductGrid({ products, priorityCount = DEFAULT_PRIORITY_ROW }: ProductGridProps) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The grid's loading state.
 *
 * Same columns and the same square aspect ratio as a real card, so the page does not jump
 * when products replace the skeleton — a skeleton of the wrong shape is worse than none,
 * because it moves the layout twice. Rendered inside a `Suspense` fallback while the
 * server component fetches.
 */
export function ProductGridSkeleton({ count = 8 }: { readonly count?: number }) {
  return (
    <ul aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_unused, index) => (
        <li key={index}>
          <Card className="h-full overflow-hidden">
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-5 w-1/2" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
