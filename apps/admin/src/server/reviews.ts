import 'server-only';

import { cache } from 'react';

import type { ReviewDoc } from '@romp/contracts';
import { asSystem, createStoreContext, listModerationQueue, systemClock } from '@romp/data';
import type { Caller, StoreContext, WithId } from '@romp/data';

import { catalogueAvailable, db, storeId } from './firebase';

/**
 * The backoffice's review-moderation read layer.
 *
 * The same seam as `orders.ts` — `server-only`, a staff caller, a build-time degradation to empty —
 * for the moderation queue. Reads the `pending` reviews awaiting a decision, oldest first, because a
 * review a customer submitted a week ago is the one they have given up on. The decisions themselves
 * (publish, reject) are client actions through the API, so they are attributed to the verified
 * operator; this read only lists the work.
 */
const context = cache((): StoreContext =>
  createStoreContext({ storeId: storeId(), db: db(), clock: systemClock }),
);

/** The staff caller the backoffice reads as. */
const caller: Caller = asSystem('backoffice review read');

/**
 * The moderation queue for the backoffice — pending reviews, oldest first.
 *
 * Returns an empty list at build time (no datastore reachable) so the page prerenders a shell and
 * fills it on the first request.
 */
export const listModerationQueueForAdmin = cache(
  async (): Promise<readonly WithId<ReviewDoc>[]> => {
    if (!catalogueAvailable()) return [];
    return listModerationQueue(context(), caller);
  },
);
