'use client';

import { useEffect, useState } from 'react';

import type { OrderView } from '@romp/contracts';
import { formatMoney } from '@romp/contracts';
import { buildWhatsappLink } from '@romp/store-config';
import { Badge, Card } from '@romp/ui';

import { useAuth } from '@/lib/auth-context';
import { OrderApiError, orderApi } from '@/lib/order-api';
import { contact, moneyFormat } from '@/lib/store';

import { fulfilmentStatusLabel, orderStatusLabel, orderStatusTone } from './order-view';
import { SignedOut } from './SignedOut';

/**
 * One of the customer's own orders, with tracking and a WhatsApp support link.
 *
 * Reads through the API (`GET /v1/orders/:id`), which is owner-or-staff — a foreign order is a 404,
 * the same as one that does not exist. The support CTA is a WhatsApp deep link **pre-filled with the
 * order's human number** (`buildWhatsappLink(contact, humanId)`), so a customer messaging about this
 * order opens a chat that already names it — support is WhatsApp because the platform sends no email
 * (ADR-0007). Signed out, the shared prompt.
 */
export function AccountOrderDetail({ orderId }: { readonly orderId: string }) {
  const { uid, ready } = useAuth();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (uid === null) {
      setOrder(null);
      return;
    }
    void orderApi
      .get(orderId)
      .then((view) => {
        setOrder(view);
      })
      .catch((cause: unknown) => {
        if (cause instanceof OrderApiError && cause.status === 404) setNotFound(true);
      });
  }, [uid, orderId]);

  if (!ready) return <p className="font-body text-text-muted">Loading…</p>;
  if (uid === null)
    return <SignedOut next={`/account/orders/${orderId}`} message="Sign in to see this order." />;
  if (notFound) return <p className="font-body text-text-muted">We could not find that order.</p>;
  if (order === null) return <p className="font-body text-text-muted">Loading…</p>;

  const supportHref = buildWhatsappLink(contact, order.humanId);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="order-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="order-heading" className="font-display text-2xl text-text-primary">
          {order.humanId}
        </h1>
        <Badge tone={orderStatusTone(order.status)}>{orderStatusLabel(order.status)}</Badge>
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
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="font-body font-semibold text-text-primary">Total</span>
          <span className="font-body font-semibold text-text-primary">
            {formatMoney(order.amounts.totalMinor, moneyFormat)}
          </span>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 p-6">
        <h2 className="font-body font-semibold text-text-primary">Delivery</h2>
        <p className="font-body text-text-secondary">
          {fulfilmentStatusLabel(order.fulfilment.status)}
        </p>
        {order.fulfilment.carrier !== null && order.fulfilment.trackingNo !== null ? (
          <p className="font-body text-sm text-text-muted">
            {order.fulfilment.carrier} · {order.fulfilment.trackingNo}
          </p>
        ) : null}
      </Card>

      <a
        href={supportHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-2 rounded-md border border-border-strong bg-surface px-4 py-2 font-body text-sm text-text-primary hover:bg-surface-alt"
      >
        Chat about this order on WhatsApp
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </section>
  );
}
