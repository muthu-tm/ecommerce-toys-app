import { Skeleton } from '@romp/ui';

import { ProductGridSkeleton } from '@/components/ProductGrid';

/**
 * The category page's route-level loading state.
 *
 * Shown while the server component fetches, and shaped like the real page — a heading bar
 * and a full grid of card skeletons — so the transition into the loaded page does not
 * shift the layout. A generic spinner here would reserve the wrong amount of space and
 * make the page jump when products arrive.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-9 w-64" />
      <ProductGridSkeleton />
    </div>
  );
}
