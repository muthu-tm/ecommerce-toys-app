import { CheckoutClient } from '@/components/CheckoutClient';

/**
 * The checkout page: `/checkout`.
 *
 * Dynamic and never cached — it acts as the signed-in customer, pricing their own cart and placing
 * their own order. The page is a thin server shell; `CheckoutClient` does the work client-side
 * because both the cart and the order path are reached through the API with the customer's session,
 * which a server render has no access to in v1.0.
 */
export const dynamic = 'force-dynamic';

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 lg:px-6">
      <CheckoutClient />
    </main>
  );
}
