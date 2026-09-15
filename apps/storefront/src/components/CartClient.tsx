'use client';

import { useEffect, useState } from 'react';

import type { CartView } from '@romp/contracts';
import { formatMoney } from '@romp/contracts';
import { Badge, Button, ButtonLink, Card, InitialTile } from '@romp/ui';

import { CartApiError, cartApi } from '@/lib/cart-api';
import { commerce, content, mediaUrl, moneyFormat } from '@/lib/store';

/**
 * The cart page body.
 *
 * A client island because the cart is per-visitor and never cached: it fetches the current cart on
 * mount (the API resolves the guest cookie or the signed-in uid) and re-renders from the `CartView`
 * every mutation returns, so a quantity change or a remove reflects without a reload. Every total
 * shown is display-only — the price the customer pays is recomputed at checkout — which is why the
 * page can render straight from the snapshotted line prices.
 *
 * Copy comes from store config: the empty-state title and body, and the button labels. The
 * per-line quantity is capped at the store's `maxQtyPerLine`; the server enforces the same ceiling
 * plus live stock, so a control that offers more than is available is corrected on the next read.
 */
export function CartClient() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void cartApi
      .get()
      .then((view) => {
        if (active) setCart(view);
      })
      .catch(() => {
        if (active) setError('Could not load your bag.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const run = (action: Promise<CartView>): void => {
    setBusy(true);
    setError(null);
    void action
      .then((view) => {
        setCart(view);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof CartApiError ? cause.message : 'Could not update your bag.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (loading) {
    return <p className="font-body text-text-muted">Loading your bag…</p>;
  }

  if (cart === null || cart.items.length === 0) {
    return (
      <Card className="mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
        <span
          aria-hidden="true"
          className="inline-flex size-14 items-center justify-center rounded-pill bg-surface-alt text-text-muted"
        >
          <svg viewBox="0 0 24 24" className="size-7" fill="none">
            <path
              d="M5 7h14l-1.2 11H6.2L5 7zM9 7V6a3 3 0 0 1 6 0v1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h1 className="font-display text-2xl text-text-primary">
          {content.emptyStates.emptyCart.title}
        </h1>
        <p className="font-body text-text-secondary">{content.emptyStates.emptyCart.body}</p>
        <ButtonLink href="/c/all">Browse toys</ButtonLink>
      </Card>
    );
  }

  return (
    <section aria-labelledby="cart-heading" className="flex flex-col gap-6">
      <h1 id="cart-heading" className="font-display text-2xl text-text-primary">
        Your bag
      </h1>

      <ul className="flex flex-col gap-3">
        {cart.items.map((item) => {
          const image = mediaUrl(item.imagePathSnapshot);
          return (
            <li
              key={item.variantId}
              className="flex items-center gap-4 rounded-md border border-border bg-surface p-4"
            >
              <span className="size-16 shrink-0 overflow-hidden rounded-md">
                {image !== null ? (
                  <img
                    src={image}
                    alt=""
                    width={64}
                    height={64}
                    className="size-16 object-cover"
                  />
                ) : (
                  <InitialTile name={item.nameSnapshot} size="sm" />
                )}
              </span>

              <div className="flex flex-1 flex-col">
                <span className="font-body font-semibold text-text-primary">
                  {item.nameSnapshot}
                </span>
                <span className="font-body text-sm text-text-muted">
                  {item.variantNameSnapshot}
                </span>
                {!item.inStock ? <Badge tone="neutral">{content.product.outOfStock}</Badge> : null}
              </div>

              <label className="flex items-center gap-2">
                <span className="sr-only">Quantity of {item.nameSnapshot}</span>
                <select
                  className="min-h-11 rounded-md border border-border-strong bg-surface px-2 font-body text-text-primary"
                  value={item.qty}
                  disabled={busy}
                  onChange={(event) => {
                    run(
                      cartApi.add({
                        productId: item.productId as never,
                        variantId: item.variantId as never,
                        qty: Number(event.target.value),
                        mode: 'set',
                      }),
                    );
                  }}
                >
                  {Array.from({ length: commerce.maxQtyPerLine }, (_, index) => index + 1).map(
                    (n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <span className="w-24 text-right font-body font-semibold text-text-primary">
                {formatMoney(item.lineSubtotalMinor, moneyFormat)}
              </span>

              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  run(cartApi.remove(item.variantId));
                }}
                aria-label={`Remove ${item.nameSnapshot}`}
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>

      <Card className="flex flex-col gap-4 bg-surface-elevated p-5">
        {commerce.giftWrapFeeMinor > 0 && (
          <label className="flex items-center justify-between gap-2 font-body text-sm text-text-primary">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={cart.giftWrap}
                disabled={busy}
                onChange={(event) => {
                  run(cartApi.setGiftWrap(event.target.checked));
                }}
              />
              Gift wrap
            </span>
            <span className="text-text-muted">
              +{formatMoney(commerce.giftWrapFeeMinor, moneyFormat)}
            </span>
          </label>
        )}

        <div className="flex items-center justify-between border-t border-border pt-4">
          <span className="font-body text-text-secondary">Subtotal</span>
          <span className="font-display text-2xl text-text-primary">
            {formatMoney(cart.subtotalMinor, moneyFormat)}
          </span>
        </div>

        {error !== null ? (
          <p role="alert" className="font-body text-sm text-danger">
            {error}
          </p>
        ) : null}

        <ButtonLink href="/checkout" fullWidth size="lg">
          Checkout
        </ButtonLink>
      </Card>
    </section>
  );
}
