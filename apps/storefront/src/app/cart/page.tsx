import { CartClient } from '@/components/CartClient';

/**
 * The cart page: `/cart`.
 *
 * Dynamic and never cached — a cart is per-visitor, and there is nothing to prerender. The page
 * itself is a thin server shell; the cart is fetched client-side by `CartClient` because it is
 * reached through the API by the signed guest cookie (or the signed-in uid), which a server render
 * has no session for in v1.0. Client auth (Task 20) will let a signed-in cart also render
 * server-side, but the API read is correct for the guest case today.
 */
export const dynamic = 'force-dynamic';

export default function CartPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 lg:px-6">
      <CartClient />
    </main>
  );
}
