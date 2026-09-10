'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ProductId, VariantId } from '@romp/contracts';
import { Button } from '@romp/ui';

import { CartApiError, cartApi } from '@/lib/cart-api';

/**
 * The add-to-cart control on the product page.
 *
 * A small client island around the button: on click it adds one of the selected variant through
 * the cart API — which refreshes the price and checks stock server-side, so nothing here decides
 * either — and on success sends the shopper to the bag. A refusal (out of stock by the time they
 * clicked, over the per-line limit) shows the server's own message rather than a generic error.
 * The label and the out-of-stock copy come from store config, passed down from the buy box.
 */
export function AddToCartButton({
  productId,
  variantId,
  inStock,
  label,
}: {
  readonly productId: string;
  readonly variantId: string;
  readonly inStock: boolean;
  readonly label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = (): void => {
    setBusy(true);
    setError(null);
    void cartApi
      .add({
        productId: productId as ProductId,
        variantId: variantId as VariantId,
        qty: 1,
        mode: 'add',
      })
      .then(() => {
        router.push('/cart');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof CartApiError ? cause.message : 'Could not add this to your bag.');
        setBusy(false);
      });
  };

  if (!inStock) {
    return (
      <Button size="lg" fullWidth disabled>
        {label}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" fullWidth loading={busy} onClick={add}>
        {label}
      </Button>
      {error !== null ? (
        <p role="alert" className="font-body text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
