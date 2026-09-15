'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';

import type { OrderView } from '@romp/contracts';
import { formatMoney } from '@romp/contracts';
import { Button, Card, Field } from '@romp/ui';

import { OrderApiError, orderApi } from '@/lib/order-api';
import { moneyFormat } from '@/lib/store';

/**
 * The order confirmation page body.
 *
 * A client island because an order is the customer's own record, read through the API with their
 * bearer token — a server render has no session for it in v1.0 (client auth is Task 20). It fetches
 * the order and renders the payment step: the UPI QR encoded from the order's `qrPayload`, which
 * fixes the exact amount and the order number so the customer pays the right total against the right
 * order. That precision is what turns the manual payment verification (Task 17) into a two-field
 * match rather than a judgement call.
 *
 * The QR is rendered client-side from the payload the server minted; the payload, not the render, is
 * the source of truth. A wrong or missing order id surfaces the API's own message rather than an
 * error screen.
 */
export function OrderConfirmation({ orderId }: { readonly orderId: string }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void orderApi
      .get(orderId)
      .then((view) => {
        if (active) setOrder(view);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof OrderApiError ? cause.message : 'Could not load your order.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  if (loading) {
    return <p className="font-body text-text-muted">Loading your order…</p>;
  }

  if (order === null) {
    return (
      <Card className="p-8 text-center">
        <h1 className="font-display text-2xl text-text-primary">We couldn’t find that order</h1>
        <p role="alert" className="mt-2 font-body text-text-muted">
          {error ?? 'This order is not available.'}
        </p>
      </Card>
    );
  }

  return (
    <section aria-labelledby="order-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 id="order-heading" className="font-display text-2xl text-text-primary">
          Order {order.humanId}
        </h1>
        <p className="font-body text-text-muted">{headline(order.status)}</p>
      </header>

      <PaymentSection order={order} onSubmitted={setOrder} />

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <h2 id="items-heading" className="font-body font-semibold text-text-primary">
          Your items
        </h2>
        <ul className="flex flex-col gap-2">
          {order.items.map((item) => (
            <li
              key={item.variantId}
              className="flex items-center justify-between rounded-md border border-border bg-surface p-3 font-body"
            >
              <span className="text-text-primary">
                {item.name} — {item.variantName} × {item.qty}
              </span>
              <span className="font-semibold text-text-primary">
                {formatMoney(item.lineTotalMinor, moneyFormat)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <dl className="flex flex-col gap-2 border-t border-border pt-4 font-body text-text-primary">
        <Row label="Subtotal" value={formatMoney(order.amounts.subtotalMinor, moneyFormat)} />
        {order.amounts.giftWrapMinor > 0 ? (
          <Row label="Gift wrap" value={formatMoney(order.amounts.giftWrapMinor, moneyFormat)} />
        ) : null}
        <Row
          label="Shipping"
          value={
            order.amounts.shippingMinor === 0
              ? 'Free'
              : formatMoney(order.amounts.shippingMinor, moneyFormat)
          }
        />
        <Row label="Tax" value={formatMoney(order.amounts.taxMinor, moneyFormat)} />
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
          <dt className="text-lg font-bold">Total</dt>
          <dd className="text-lg font-bold">
            {formatMoney(order.amounts.totalMinor, moneyFormat)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** The one-line status headline under the order number. */
function headline(status: OrderView['status']): string {
  switch (status) {
    case 'awaiting_payment':
      return 'Thank you. Pay with the UPI QR below, then submit your payment reference.';
    case 'pending_verification':
      return 'We are checking your payment. You will hear from us once it is confirmed.';
    case 'payment_rejected':
      return 'We could not match your last payment. Check the reference and submit it again.';
    case 'paid':
      return 'Payment confirmed. Your order is being prepared.';
    case 'expired':
      return 'This order expired before payment arrived. Nothing was charged.';
    case 'cancelled':
      return 'This order was cancelled.';
    case 'refunded':
      return 'This order was refunded.';
    default:
      return '';
  }
}

/** Order statuses where the customer may submit (or resubmit) a payment reference. */
const AWAITING_PROOF: readonly OrderView['status'][] = ['awaiting_payment', 'payment_rejected'];

/**
 * The payment step, driven by the order's status.
 *
 * While the order is awaiting payment (or was rejected and may be resubmitted), it shows the UPI QR
 * — rendered from the server-minted payload — and a form to submit the transaction reference. Once a
 * reference is in, it shows an under-review message; a rejection shows the reason the admin gave, so
 * the customer can fix and resubmit. The submit is optimistic only in that it re-renders from the
 * response's status; the authoritative record is the order the API returns.
 */
function PaymentSection({
  order,
  onSubmitted,
}: {
  readonly order: OrderView;
  readonly onSubmitted: (order: OrderView) => void;
}) {
  const [upiRef, setUpiRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!AWAITING_PROOF.includes(order.status)) {
    // pending_verification / paid / expired / cancelled — the headline already says what is going
    // on; nothing for the customer to do here.
    return null;
  }

  const submit = (): void => {
    const trimmed = upiRef.trim();
    if (trimmed === '') {
      setError('Enter the UPI reference from your payment.');
      return;
    }
    setBusy(true);
    setError(null);
    void orderApi
      .submitPaymentProof(order.orderId, { upiRef: trimmed, screenshotPath: null })
      .then((result) => {
        // Re-render from the returned status (now pending_verification).
        onSubmitted({ ...order, status: result.status });
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof OrderApiError
            ? cause.message
            : 'Could not submit your payment reference.',
        );
        setBusy(false);
      });
  };

  return (
    <Card className="flex flex-col items-center gap-4 bg-surface-elevated p-6">
      <h2 className="font-display text-lg text-text-primary">Scan to pay</h2>
      {/* A white frame around the QR so it scans reliably in dark mode, where a QR drawn in
          the theme's text colour on a dark surface confuses many scanners. */}
      <span className="rounded-md bg-surface p-3">
        <QRCodeSVG
          value={order.payment.qrPayload}
          size={220}
          marginSize={4}
          title={`UPI payment for order ${order.humanId}`}
          data-testid="upi-qr"
        />
      </span>
      <p className="font-body text-lg font-bold text-text-primary">
        {formatMoney(order.amounts.totalMinor, moneyFormat)}
      </p>
      <p className="font-body text-sm text-text-muted">
        Open any UPI app and scan, or use the reference {order.humanId} when you pay.
      </p>

      {order.status === 'payment_rejected' && order.payment.rejectionReason !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {order.payment.rejectionReason}
        </p>
      ) : null}

      <div className="flex w-full max-w-sm flex-col gap-3">
        <Field
          label="UPI transaction reference"
          hint="The reference your UPI app shows after you pay."
          value={upiRef}
          disabled={busy}
          onChange={(event) => {
            setUpiRef(event.target.value);
          }}
        />
        {error !== null ? (
          <p role="alert" className="font-body text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit payment reference'}
        </Button>
      </div>
    </Card>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
