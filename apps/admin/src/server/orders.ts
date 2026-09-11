import 'server-only';

import { cache } from 'react';

import type {
  DailyAnalyticsDoc,
  FulfilmentStatus,
  OrderDoc,
  OrderEventDoc,
  OrderStatus,
} from '@romp/contracts';
import {
  asSystem,
  createStoreContext,
  findOrder,
  listDailyAnalytics,
  listOrderEvents,
  listOrders,
  systemClock,
} from '@romp/data';
import type { Caller, StoreContext, WithId } from '@romp/data';

import { catalogueAvailable, db, storeId } from './firebase';

/**
 * The backoffice's order and analytics read layer.
 *
 * The same shape and the same seam as `catalogue.ts` — `server-only`, a staff caller, and a
 * build-time degradation to empty — for the order screens and the dashboard. Reads see every
 * order regardless of status, because staff triage the whole queue; the public storefront never
 * reaches this code. Per-operator identity replaces the system caller in Task 20; what changes then
 * is whose uid is attributed, not what is visible.
 */
const context = cache((): StoreContext =>
  createStoreContext({ storeId: storeId(), db: db(), clock: systemClock }),
);

/** The staff caller the backoffice reads as. Replaced by the verified operator in Task 20. */
const caller: Caller = asSystem('backoffice read');

/** How many orders a list page shows before its cursor. */
const ORDER_LIST_LIMIT = 25;

/** A page of orders and the cursor for the next one, as the list screen renders them. */
export interface OrderListPage {
  readonly orders: readonly WithId<OrderDoc>[];
  readonly nextCursor: string | null;
}

/**
 * The order list for the backoffice, newest first, optionally filtered or searched.
 *
 * Returns an empty page at build time (no datastore reachable) so the page prerenders a shell and
 * fills it on the first request. A `humanId` is a search that returns the one matching order; a
 * status or fulfilment filter narrows the set; a cursor pages through it.
 */
export const listOrdersForAdmin = cache(
  async (
    options: {
      readonly status?: OrderStatus;
      readonly fulfilmentStatus?: FulfilmentStatus;
      readonly humanId?: string;
      readonly cursor?: string;
    } = {},
  ): Promise<OrderListPage> => {
    if (!catalogueAvailable()) return { orders: [], nextCursor: null };
    const page = await listOrders(context(), caller, { ...options, limit: ORDER_LIST_LIMIT });
    return { orders: page.items, nextCursor: page.nextCursor };
  },
);

/** An order with its audit trail, for the detail screen. Null for a missing order or at build time. */
export const getOrderForAdmin = cache(
  async (
    orderId: string,
  ): Promise<{
    readonly order: WithId<OrderDoc>;
    readonly events: readonly WithId<OrderEventDoc>[];
  } | null> => {
    if (!catalogueAvailable()) return null;
    try {
      const order = await findOrder(context(), caller, orderId);
      const events = await listOrderEvents(context(), caller, orderId);
      return { order, events };
    } catch {
      // `findOrder` throws a not-found for a missing or hidden order; the page renders a not-found.
      return null;
    }
  },
);

/**
 * The daily analytics rollups for the dashboard's date range.
 *
 * Reads pre-computed rollup documents — never a live scan of orders — so the dashboard cost is
 * bounded by the range, not the order volume. Empty at build time.
 */
export const getDailyAnalytics = cache(
  async (range: {
    readonly from: string;
    readonly to: string;
  }): Promise<readonly DailyAnalyticsDoc[]> => {
    if (!catalogueAvailable()) return [];
    const rows = await listDailyAnalytics(context(), caller, range);
    return rows.map((row) => ({ ...row }));
  },
);
