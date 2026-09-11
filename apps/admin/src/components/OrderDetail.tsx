import type { Money, OrderDoc, OrderEventDoc } from '@romp/contracts';
import type { WithId } from '@romp/data';
import { Badge, Card } from '@romp/ui';

import {
  fulfilmentStatusLabel,
  fulfilmentStatusTone,
  orderEventLabel,
  orderStatusLabel,
  orderStatusTone,
} from '@/lib/order-view';
import { formatMoney, locale, moneyFormat } from '@/lib/store';

import { OrderActions } from './OrderActions';

/**
 * The backoffice order detail.
 *
 * A server component for everything that is a read — the summary, the line items, the amounts, and
 * the append-only audit timeline — with the operational controls (`OrderActions`) as the one client
 * island, because those are actions. The timeline is the order's own event trail oldest-first, which
 * is the record that answers "who did what, and when" for the manual-payment audit.
 */
export function OrderDetail({
  order,
  events,
}: {
  readonly order: WithId<OrderDoc>;
  readonly events: readonly WithId<OrderEventDoc>[];
}) {
  const dateFormat = new Intl.DateTimeFormat(locale.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: locale.timezone,
  });

  return (
    <section aria-labelledby="order-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="order-heading" className="font-display text-2xl text-text-primary">
          {order.humanId}
        </h1>
        <div className="flex items-center gap-2">
          <Badge tone={orderStatusTone(order.status)}>{orderStatusLabel(order.status)}</Badge>
          <Badge tone={fulfilmentStatusTone(order.fulfilment.status)}>
            {fulfilmentStatusLabel(order.fulfilment.status)}
          </Badge>
        </div>
      </div>

      <Card className="flex flex-col gap-3 p-6">
        <h2 className="font-body font-semibold text-text-primary">Items</h2>
        <ul className="flex flex-col gap-2">
          {order.items.map((item) => (
            <li key={item.variantId} className="flex items-center justify-between">
              <span className="font-body text-text-primary">
                {item.name}
                <span className="ml-2 font-body text-sm text-text-muted">{item.variantName}</span>
              </span>
              <span className="font-body text-sm text-text-primary">
                {item.qty} × {formatMoney(item.unitPriceMinor, moneyFormat)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1 border-t border-border pt-3">
          <Amount label="Subtotal" minor={order.amounts.subtotalMinor} />
          {order.amounts.giftWrapMinor > 0 ? (
            <Amount label="Gift wrap" minor={order.amounts.giftWrapMinor} />
          ) : null}
          <Amount label="Shipping" minor={order.amounts.shippingMinor} />
          <Amount label="Tax" minor={order.amounts.taxMinor} />
          <Amount label="Total" minor={order.amounts.totalMinor} emphasis />
          {order.amounts.refundedMinor > 0 ? (
            <Amount label="Refunded" minor={order.amounts.refundedMinor} />
          ) : null}
        </dl>
      </Card>

      <Card className="p-6">
        <OrderActions
          orderId={order.id}
          orderStatus={order.status}
          fulfilmentStatus={order.fulfilment.status}
        />
      </Card>

      <Card className="flex flex-col gap-3 p-6">
        <h2 className="font-body font-semibold text-text-primary">History</h2>
        {events.length === 0 ? (
          <p className="font-body text-sm text-text-muted">No events recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {events.map((event) => (
              <li key={event.id} className="flex items-center justify-between">
                <span className="font-body text-text-primary">{orderEventLabel(event.type)}</span>
                <time
                  className="font-body text-sm text-text-muted"
                  dateTime={event.at.toISOString()}
                >
                  {dateFormat.format(event.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

/** One amount row in the summary. */
function Amount({
  label,
  minor,
  emphasis,
}: {
  readonly label: string;
  readonly minor: Money;
  readonly emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt
        className={
          emphasis ? 'font-body font-semibold text-text-primary' : 'font-body text-text-muted'
        }
      >
        {label}
      </dt>
      <dd
        className={
          emphasis ? 'font-body font-semibold text-text-primary' : 'font-body text-text-primary'
        }
      >
        {formatMoney(minor, moneyFormat)}
      </dd>
    </div>
  );
}
