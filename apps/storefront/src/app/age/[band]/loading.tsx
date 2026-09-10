import { Skeleton } from '@romp/ui';

import { ProductGridSkeleton } from '@/components/ProductGrid';

/** The age page's route-level loading state, shaped like the loaded page. See the category loading. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-9 w-48" />
      <ProductGridSkeleton />
    </div>
  );
}
