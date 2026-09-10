'use client';

import { useEffect, useState } from 'react';

import { cartApi } from '@/lib/cart-api';

/**
 * The header's bag count.
 *
 * A client island that fetches the cart's item count once on mount and shows it as a small badge on
 * the bag icon. It is best-effort and quiet: if the fetch fails, or the cart is empty, nothing
 * renders — a missing badge is a smaller problem than a broken header. A full live subscription
 * across tabs is a later refinement; for v1.0 the count is accurate on load and after a navigation,
 * which is when it matters.
 */
export function CartBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    void cartApi
      .get()
      .then((view) => {
        if (active) setCount(view.itemCount);
      })
      .catch(() => {
        // A header badge is not worth surfacing an error for.
      });
    return () => {
      active = false;
    };
  }, []);

  if (count <= 0) return null;

  return (
    <span
      aria-label={`${String(count)} item${count === 1 ? '' : 's'} in your bag`}
      className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-pill bg-accent px-1.5 font-body text-xs font-bold text-accent-on"
    >
      {count}
    </span>
  );
}
