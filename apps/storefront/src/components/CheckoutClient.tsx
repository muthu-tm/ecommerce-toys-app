'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { CheckoutQuoteResponse, DeliverySpeed } from '@romp/contracts';
import { formatMoney } from '@romp/contracts';
import { Button, ButtonLink, Card } from '@romp/ui';

import { OrderApiError, orderApi } from '@/lib/order-api';
import { moneyFormat } from '@/lib/store';
import { useCheckoutSession } from '@/lib/use-checkout';
import type { CheckoutAddress } from '@/lib/use-checkout';

/**
 * The checkout page body.
 *
 * A client island because it acts as the signed-in customer: it reads their saved addresses through
 * the client SDK, requests a live quote from the API (which recomputes every total from live
 * prices), and places the order — which reserves stock and mints the UPI QR — then navigates to the
 * confirmation page. Nothing about money is sent up; the customer only chooses an address and a
 * delivery speed, and everything priced comes back from the server.
 *
 * It degrades honestly. A signed-out visitor is asked to sign in (client auth is Task 20); a
 * customer with no saved address is told to add one first (address management is a later task); an
 * empty cart or a vanished item surfaces the server's own message. None of these are error screens —
 * they are the real states of a checkout before its upstream pieces exist.
 */
export function CheckoutClient() {
  const router = useRouter();
  const { uid, ready, addresses } = useCheckoutSession();

  const [addressId, setAddressId] = useState<string | null>(null);
  const [deliverySpeed, setDeliverySpeed] = useState<DeliverySpeed>('standard');
  const [quote, setQuote] = useState<CheckoutQuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselect the default (first) address once they load.
  useEffect(() => {
    const first = addresses[0];
    if (addressId === null && first !== undefined) {
      setAddressId(first.id);
    }
  }, [addresses, addressId]);

  const refreshQuote = useCallback(
    (speed: DeliverySpeed): void => {
      if (uid === null) return;
      setQuoting(true);
      setError(null);
      void orderApi
        .quote({ deliverySpeed: speed })
        .then((next) => {
          setQuote(next);
        })
        .catch((cause: unknown) => {
          setQuote(null);
          setError(cause instanceof OrderApiError ? cause.message : 'Could not price your bag.');
        })
        .finally(() => {
          setQuoting(false);
        });
    },
    [uid],
  );

  // Fetch a quote once we know who is signed in and can check out, and whenever the delivery speed
  // changes. No point pricing a bag the customer cannot place — a signed-out visitor or one with no
  // address never gets past the states below.
  useEffect(() => {
    if (ready && uid !== null && addresses.length > 0) refreshQuote(deliverySpeed);
  }, [ready, uid, addresses.length, deliverySpeed, refreshQuote]);

  const place = (): void => {
    if (addressId === null) return;
    setPlacing(true);
    setError(null);
    void orderApi
      .place({ addressId: addressId as never, deliverySpeed, isGift: false, giftMessage: null })
      .then((placed) => {
        router.push(`/orders/${placed.orderId}`);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof OrderApiError ? cause.message : 'Could not place your order.');
        setPlacing(false);
      });
  };

  if (!ready) {
    return <p className="font-body text-text-muted">Loading checkout…</p>;
  }

  if (uid === null) {
    return (
      <Card className="p-8 text-center">
        <h1 className="font-display text-2xl text-text-primary">Sign in to check out</h1>
        <p className="mt-2 font-body text-text-muted">
          You need to be signed in to place an order.
        </p>
      </Card>
    );
  }

  if (addresses.length === 0) {
    return (
      <Card className="p-8 text-center">
        <h1 className="font-display text-2xl text-text-primary">Add a delivery address</h1>
        <p className="mt-2 font-body text-text-muted">
          You need a saved address before you can check out.
        </p>
      </Card>
    );
  }

  return (
    <section aria-labelledby="checkout-heading" className="flex flex-col gap-6">
      <h1 id="checkout-heading" className="font-display text-2xl text-text-primary">
        Checkout
      </h1>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-body font-semibold text-text-primary">Deliver to</legend>
        {addresses.map((address) => (
          <AddressOption
            key={address.id}
            address={address}
            checked={address.id === addressId}
            onSelect={() => {
              setAddressId(address.id);
            }}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-body font-semibold text-text-primary">Delivery speed</legend>
        <div className="flex gap-4">
          {(['standard', 'express'] as const).map((speed) => (
            <label key={speed} className="flex items-center gap-2 font-body text-text-primary">
              <input
                type="radio"
                name="delivery-speed"
                className="size-4"
                value={speed}
                checked={deliverySpeed === speed}
                disabled={placing}
                onChange={() => {
                  setDeliverySpeed(speed);
                }}
              />
              {speed === 'standard' ? 'Standard' : 'Express'}
            </label>
          ))}
        </div>
      </fieldset>

      {quote !== null ? (
        <dl className="flex flex-col gap-2 border-t border-border pt-4 font-body text-text-primary">
          <Row label="Subtotal" value={formatMoney(quote.subtotalMinor, moneyFormat)} />
          {quote.giftWrapMinor > 0 ? (
            <Row label="Gift wrap" value={formatMoney(quote.giftWrapMinor, moneyFormat)} />
          ) : null}
          <Row
            label="Shipping"
            value={
              quote.shippingMinor === 0 ? 'Free' : formatMoney(quote.shippingMinor, moneyFormat)
            }
          />
          <Row label="Tax" value={formatMoney(quote.taxMinor, moneyFormat)} />
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <dt className="text-lg font-bold">Total</dt>
            <dd className="text-lg font-bold" data-testid="checkout-total">
              {formatMoney(quote.totalMinor, moneyFormat)}
            </dd>
          </div>
        </dl>
      ) : null}

      {error !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <ButtonLink href="/cart" variant="ghost">
          Back to bag
        </ButtonLink>
        <Button
          onClick={place}
          disabled={placing || quoting || quote === null || addressId === null}
        >
          {placing ? 'Placing order…' : 'Place order'}
        </Button>
      </div>
    </section>
  );
}

function AddressOption({
  address,
  checked,
  onSelect,
}: {
  readonly address: CheckoutAddress;
  readonly checked: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface p-4">
      <input
        type="radio"
        name="checkout-address"
        className="mt-1 size-4"
        checked={checked}
        onChange={onSelect}
      />
      <span className="flex flex-col font-body text-text-primary">
        <span className="font-semibold">
          {address.label} — {address.recipientName}
        </span>
        <span className="text-sm text-text-muted">
          {address.line1}
          {address.line2 !== null ? `, ${address.line2}` : ''}, {address.city}, {address.state}{' '}
          {address.pincode}
        </span>
      </span>
    </label>
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
