'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { OrderView } from '@romp/contracts';
import { formatMoney } from '@romp/contracts';
import { Badge, Card } from '@romp/ui';

import { accountApi } from '@/lib/account-api';
import { useAuth } from '@/lib/auth-context';
import { content, moneyFormat } from '@/lib/store';

import { orderStatusLabel, orderStatusTone } from './order-view';
import { SignedOut } from './SignedOut';

/**
 * The customer's order history — their own orders, newest first, each linking to its detail.
 *
 * Reads through the API (`GET /v1/orders`), which filters on the caller's uid server-side. The empty
 * state is the store's own "no orders yet" copy. Signed out, the shared prompt.
 */
export function OrderHistory() {
  const { uid, ready } = useAuth();
  const [orders, setOrders] = useState<readonly OrderView[] | null>(null);

  useEffect(() => {
    if (uid === null) {
      setOrders(null);
      return;
    }
    void accountApi
      .listOrders()
      .then((response) => {
        setOrders(response.orders);
      })
      .catch(() => {
        setOrders([]);
      });
  }, [uid]);

  if (!ready) return <p className="font-body text-text-muted">Loading…</p>;
  if (uid === null)
    return <SignedOut next="/account/orders" message="Sign in to see your orders." />;

  const empty = content.emptyStates.emptyOrders;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="orders-heading">
      <h1 id="orders-heading" className="font-display text-2xl text-text-primary">
        Your orders
      </h1>

      {orders === null ? (
        <p className="font-body text-text-muted">Loading…</p>
      ) : orders.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-display text-base text-text-primary">{empty.title}</p>
          <p className="mt-1 font-body text-sm text-text-muted">{empty.body}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((order) => (
            <li key={order.orderId}>
              <Link
                href={`/account/orders/${order.orderId}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 hover:border-border-strong"
              >
                <span className="flex flex-col">
                  <span className="font-body font-semibold text-text-primary">{order.humanId}</span>
                  <span className="font-body text-sm text-text-muted">
                    {order.items.length} item{order.items.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-body text-sm text-text-primary">
                    {formatMoney(order.amounts.totalMinor, moneyFormat)}
                  </span>
                  <Badge tone={orderStatusTone(order.status)}>
                    {orderStatusLabel(order.status)}
                  </Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
