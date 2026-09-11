'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { FulfilmentStatus, OrderStatus } from '@romp/contracts';
import { Button } from '@romp/ui';

import { ApiError, adminApi } from '@/lib/api';
import { fulfilmentActions } from '@/lib/fulfilment-actions';

/**
 * The order's operational controls: advance fulfilment, and cancel.
 *
 * A client component, because these are actions, not navigations. It offers only the fulfilment
 * moves the machine permits from the current stage (via `fulfilmentActions`), and it gates packing
 * on the order being paid — the same cross-machine rule the server enforces — so an unpaid order
 * shows no "Mark packed". Shipping collects a carrier and tracking number, a hold collects a reason,
 * and a cancel collects a reason and a restock choice, because those are what the contracts require.
 *
 * Until operator sign-in lands (Task 20) every write returns "Sign in as a staff member" from the
 * API client, so the controls render and explain rather than silently doing nothing — the same inert
 * posture the catalogue controls take.
 */
export function OrderActions({
  orderId,
  orderStatus,
  fulfilmentStatus,
}: {
  readonly orderId: string;
  readonly orderStatus: OrderStatus;
  readonly fulfilmentStatus: FulfilmentStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carrier, setCarrier] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [restock, setRestock] = useState(false);

  const run = (action: () => Promise<unknown>): void => {
    setPending(true);
    setError(null);
    void action()
      .then(() => {
        router.refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'The action could not be completed.');
      })
      .finally(() => {
        setPending(false);
      });
  };

  const advance = (to: FulfilmentStatus): void => {
    if (to === 'shipped') {
      run(() =>
        adminApi.advanceFulfilment(orderId, {
          status: 'shipped',
          carrier,
          trackingNo,
          holdReason: null,
        }),
      );
      return;
    }
    if (to === 'on_hold') {
      run(() =>
        adminApi.advanceFulfilment(orderId, {
          status: 'on_hold',
          carrier: null,
          trackingNo: null,
          holdReason,
        }),
      );
      return;
    }
    run(() =>
      adminApi.advanceFulfilment(orderId, {
        status: to,
        carrier: null,
        trackingNo: null,
        holdReason: null,
      }),
    );
  };

  // Packing is gated on payment, the cross-machine rule; the server refuses otherwise, but hiding it
  // keeps the affordance honest.
  const actions = fulfilmentActions(fulfilmentStatus).filter(
    (action) => action.to !== 'packed' || orderStatus === 'paid',
  );

  const canCancel =
    orderStatus !== 'cancelled' && orderStatus !== 'expired' && orderStatus !== 'refunded';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="font-body font-semibold text-text-primary">Fulfilment</h3>
        <div className="flex flex-wrap items-end gap-3">
          {actions.some((action) => action.to === 'shipped') && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-body text-sm text-text-muted">Carrier</span>
                <input
                  value={carrier}
                  onChange={(event) => {
                    setCarrier(event.target.value);
                  }}
                  className="rounded-md border border-border bg-surface px-3 py-2 font-body text-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-body text-sm text-text-muted">Tracking number</span>
                <input
                  value={trackingNo}
                  onChange={(event) => {
                    setTrackingNo(event.target.value);
                  }}
                  className="rounded-md border border-border bg-surface px-3 py-2 font-body text-text-primary"
                />
              </label>
            </div>
          )}
          {actions.some((action) => action.to === 'on_hold') && (
            <label className="flex flex-col gap-1">
              <span className="font-body text-sm text-text-muted">Hold reason</span>
              <input
                value={holdReason}
                onChange={(event) => {
                  setHoldReason(event.target.value);
                }}
                className="rounded-md border border-border bg-surface px-3 py-2 font-body text-text-primary"
              />
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.length === 0 ? (
            <p className="font-body text-sm text-text-muted">No further fulfilment steps.</p>
          ) : (
            actions.map((action) => (
              <Button
                key={action.to}
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  advance(action.to);
                }}
              >
                {action.label}
              </Button>
            ))
          )}
        </div>
      </div>

      {canCancel && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="font-body font-semibold text-text-primary">Cancel order</h3>
          <label className="flex flex-col gap-1">
            <span className="font-body text-sm text-text-muted">
              Reason (shown to the customer)
            </span>
            <input
              value={cancelReason}
              onChange={(event) => {
                setCancelReason(event.target.value);
              }}
              className="rounded-md border border-border bg-surface px-3 py-2 font-body text-text-primary"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={restock}
              onChange={(event) => {
                setRestock(event.target.checked);
              }}
            />
            <span className="font-body text-sm text-text-primary">Return the units to stock</span>
          </label>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={pending || cancelReason.trim() === ''}
              onClick={() => {
                run(() => adminApi.cancelOrder(orderId, { reason: cancelReason, restock }));
              }}
            >
              Cancel order
            </Button>
          </div>
        </div>
      )}

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
