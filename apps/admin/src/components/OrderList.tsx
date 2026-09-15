import Link from 'next/link';

import type { OrderDoc, OrderStatus } from '@romp/contracts';
import { OrderStatusSchema } from '@romp/contracts';
import type { WithId } from '@romp/data';
import { Badge, ButtonLink, Card, PageHeader } from '@romp/ui';

import {
  fulfilmentStatusLabel,
  fulfilmentStatusTone,
  orderStatusLabel,
  orderStatusTone,
} from '@/lib/order-view';
import { formatMoney, moneyFormat } from '@/lib/store';

/**
 * The backoffice order list.
 *
 * A server component: orders are read as a staff caller, so every status appears. Filtering,
 * search and paging are URL-driven — a status link sets `?status=`, the search form submits a
 * `humanId`, and the next-page control carries the cursor — so the whole screen stays a server
 * component with no client state, and a filtered view is a shareable, reloadable URL.
 */
export function OrderList({
  orders,
  nextCursor,
  activeStatus,
  humanId,
}: {
  readonly orders: readonly WithId<OrderDoc>[];
  readonly nextCursor: string | null;
  readonly activeStatus?: OrderStatus;
  readonly humanId?: string;
}) {
  return (
    <section aria-labelledby="orders-heading" className="flex flex-col gap-6">
      <PageHeader title={<span id="orders-heading">Orders</span>} />

      <form role="search" action="/orders" method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-body text-sm text-text-muted">Search by order number</span>
          <input
            type="search"
            name="humanId"
            defaultValue={humanId ?? ''}
            placeholder="RMP-24817"
            className="rounded-md border border-border bg-surface px-3 py-2 font-body text-text-primary"
          />
        </label>
        <ButtonLink href="/orders">Clear</ButtonLink>
        <button
          type="submit"
          className="rounded-md border border-border-strong bg-surface px-4 py-2 font-body text-sm text-text-primary"
        >
          Search
        </button>
      </form>

      <nav aria-label="Filter by payment status" className="flex flex-wrap gap-2">
        <StatusFilter label="All" href="/orders" active={activeStatus === undefined} />
        {OrderStatusSchema.options.map((status) => (
          <StatusFilter
            key={status}
            label={orderStatusLabel(status)}
            href={`/orders?status=${status}`}
            active={activeStatus === status}
          />
        ))}
      </nav>

      {orders.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-body text-text-muted">No orders match this view.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((order) => (
            <li key={order.id}>
              <Card interactive>
                <Link
                  href={`/orders/${order.id}`}
                  className="flex flex-wrap items-center justify-between gap-4 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <span className="flex flex-col">
                    <span className="font-body font-semibold text-text-primary">
                      {order.humanId}
                    </span>
                    <span className="font-body text-sm text-text-muted">
                      {order.items.length} item{order.items.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-body font-semibold text-text-primary">
                      {formatMoney(order.amounts.totalMinor, moneyFormat)}
                    </span>
                    <Badge tone={orderStatusTone(order.status)}>
                      {orderStatusLabel(order.status)}
                    </Badge>
                    <Badge tone={fulfilmentStatusTone(order.fulfilment.status)}>
                      {fulfilmentStatusLabel(order.fulfilment.status)}
                    </Badge>
                  </span>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {nextCursor !== null && (
        <div className="flex justify-center">
          <ButtonLink
            href={`/orders?${new URLSearchParams({
              ...(activeStatus === undefined ? {} : { status: activeStatus }),
              cursor: nextCursor,
            }).toString()}`}
          >
            Next page
          </ButtonLink>
        </div>
      )}
    </section>
  );
}

/** A single status-filter pill; the active one is marked for assistive technology. */
function StatusFilter({
  label,
  href,
  active,
}: {
  readonly label: string;
  readonly href: string;
  readonly active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-pill border border-border-strong bg-surface-alt px-3 py-1 font-body text-sm font-bold text-text-primary'
          : 'rounded-pill border border-border px-3 py-1 font-body text-sm text-text-muted hover:text-text-primary'
      }
    >
      {label}
    </Link>
  );
}
