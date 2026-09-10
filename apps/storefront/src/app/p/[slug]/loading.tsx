import { Skeleton } from '@romp/ui';

/**
 * The product page's route-level loading state.
 *
 * Shaped like the real PDP — a breadcrumb bar, a square gallery frame beside a stack of
 * buy-box lines — so the loaded page does not shift the layout when it arrives. The
 * gallery skeleton is the same aspect-square box the real gallery reserves, which is what
 * keeps the largest element on the page from jumping.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-5 w-64" />
      <div className="grid gap-8 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-lg" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
