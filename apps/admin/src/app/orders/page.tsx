import { OrderStatusSchema } from '@romp/contracts';
import type { OrderStatus } from '@romp/contracts';

import { OrderList } from '@/components/OrderList';
import { listOrdersForAdmin } from '@/server/orders';

/**
 * The backoffice order list.
 *
 * A server component reading as a staff caller, so every status appears. Filtering, search and
 * paging are read from the URL, so a filtered view is a shareable link and the whole page stays a
 * server render. Dynamic, not cached — staff expect to see an order's new state immediately.
 */
export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const humanId =
    typeof params.humanId === 'string' && params.humanId !== '' ? params.humanId : undefined;
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;

  const page = await listOrdersForAdmin({
    ...(status === undefined ? {} : { status }),
    ...(humanId === undefined ? {} : { humanId }),
    ...(cursor === undefined ? {} : { cursor }),
  });

  return (
    <OrderList
      orders={page.orders}
      nextCursor={page.nextCursor}
      {...(status === undefined ? {} : { activeStatus: status })}
      {...(humanId === undefined ? {} : { humanId })}
    />
  );
}

/** Narrows a query value to a valid order status, or undefined. */
function parseStatus(value: string | string[] | undefined): OrderStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = OrderStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
