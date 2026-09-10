import { createStoreContext, systemClock } from '@romp/data';
import type { StoreContext } from '@romp/data';
import storeConfig from '@romp/store-config/generated/store-config.json';

import { db } from '../firebase';

/**
 * The `StoreContext` the background functions run under.
 *
 * A `system` caller's context: the dispatcher and the backlog alarm act with no human
 * behind them, reading and writing across the whole store by definition. Memoised so a warm
 * function instance reuses one Firestore binding rather than rebuilding it per invocation.
 */
let context: StoreContext | undefined;

export function storeContext(): StoreContext {
  context ??= createStoreContext({
    storeId: storeConfig.brand.id,
    db: db(),
    clock: systemClock,
  });
  return context;
}
